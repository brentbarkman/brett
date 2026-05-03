import SwiftUI
import AVFoundation
import Foundation
import Speech

// MARK: - Amplitude throttle

/// Peak-hold + interval-throttle helper for the audio-tap callback.
///
/// The audio thread feeds per-buffer RMS samples into `observe(_:)`; the
/// helper keeps the loudest reading since the last successful push and
/// returns it (and only it) once `pushInterval` seconds have elapsed.
/// Returning `nil` means "still inside the window — don't dispatch."
///
/// Lock-protected so the audio queue can call it without the @MainActor
/// hopping that the pre-throttle implementation needed per buffer.
/// `@unchecked Sendable` because the only mutable state is guarded by
/// the lock.
final class AmplitudeThrottle: @unchecked Sendable {
    private let pushInterval: TimeInterval
    private let lock = NSLock()
    private var peak: Double = 0
    private var lastPushAt: Date = .distantPast

    init(pushInterval: TimeInterval) {
        self.pushInterval = pushInterval
    }

    /// Observe a fresh RMS sample. Returns the peak-since-last-push when
    /// the throttle window has elapsed; otherwise `nil` (caller drops).
    /// `now` is injectable for tests.
    func observe(_ rms: Double, now: Date = Date()) -> Double? {
        lock.lock()
        defer { lock.unlock() }
        peak = max(peak, rms)
        guard now.timeIntervalSince(lastPushAt) >= pushInterval else {
            return nil
        }
        let value = peak
        peak = 0
        lastPushAt = now
        return value
    }

    /// Drop accumulated state. Called when a recording session
    /// (re)starts so a stale peak from a prior session doesn't leak in.
    func reset() {
        lock.lock()
        peak = 0
        lastPushAt = .distantPast
        lock.unlock()
    }
}

// MARK: - Voice recognition model

/// Drives the microphone + SFSpeechRecognizer pipeline. Publishes the
/// live transcript and a normalized 0-1 amplitude for the waveform
/// visualizer. UI-facing, so marked `@MainActor`.
@MainActor
@Observable
final class VoiceRecognizer {

    // MARK: Published

    /// The latest partial transcript from `SFSpeechRecognizer`.
    var transcript: String = ""

    /// Normalized RMS amplitude (0…1). Drives the waveform bars.
    var amplitude: Double = 0

    /// True while the mic is capturing.
    var isRecording: Bool = false

    /// Set when an unrecoverable error happens; UI surfaces this and bails.
    var errorMessage: String? = nil

    // MARK: Private

    private let audioEngine = AVAudioEngine()
    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    /// Timer that fires when no speech has been observed for a while.
    /// Triggers auto-submit.
    private var silenceTimer: Timer?

    /// Caller supplies this on init; fires once when silence has been
    /// detected for `silenceWindow`.
    private var onSilence: (() -> Void)?

    /// How long of a quiet period before we call it done.
    private let silenceWindow: TimeInterval = 1.5

    /// Amplitude considered "speech" — anything above this resets the
    /// silence timer.
    private let speechThreshold: Double = 0.06

    /// Coalesces per-buffer amplitude samples on the audio thread and
    /// reports a peak-hold value at most every 50ms. The audio tap fires
    /// at ~43Hz; pushing every buffer onto the main actor would spawn
    /// ~43 Tasks/sec just to nudge a Double. The waveform UI only
    /// animates at ~50ms granularity anyway, so this throttling is
    /// invisible to the user but eliminates the per-buffer Task
    /// allocation churn during voice mode.
    private let amplitudeThrottle = AmplitudeThrottle(pushInterval: 0.05)

    init() {
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    var isAvailable: Bool {
        speechRecognizer?.isAvailable == true
    }

    // MARK: Public lifecycle

    /// Request mic + speech auth. Callback receives `true` only when both
    /// are granted.
    func requestAuthorization(_ completion: @Sendable @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            let speechOk = speechStatus == .authorized
            AVAudioApplication.requestRecordPermission { micOk in
                DispatchQueue.main.async {
                    completion(speechOk && micOk)
                }
            }
        }
    }

    func start(onSilence: @escaping () -> Void) {
        guard !isRecording else { return }
        self.onSilence = onSilence
        self.errorMessage = nil
        self.transcript = ""
        self.amplitude = 0

        // Configure session for recording.
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            errorMessage = "Couldn't start audio session."
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.recognitionRequest = request

        guard let speechRecognizer, speechRecognizer.isAvailable else {
            errorMessage = "Speech recognition isn't available right now."
            return
        }

        // Kick off the recognition task.
        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    self.resetSilenceTimer()
                }
                if error != nil {
                    self.stop(fireSilence: false)
                }
            }
        }

        // Reset the throttle accumulator — a previous start() may have left
        // peak/timestamp values from a prior session.
        amplitudeThrottle.reset()

        // Tap the input node — each buffer goes to the recognizer + amplitude
        // sampler. Recognition append happens per-buffer because Speech
        // expects continuous audio; amplitude is throttled via the
        // peak-hold accumulator so we only hop to the main actor at ~20Hz
        // instead of ~43Hz, eliminating the Task-per-buffer churn that the
        // pre-throttle implementation incurred.
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        let throttle = amplitudeThrottle
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)

            let rms = VoiceRecognizer.rmsAmplitude(from: buffer)
            guard let peak = throttle.observe(rms) else { return }

            Task { @MainActor [weak self] in
                self?.updateAmplitude(peak)
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isRecording = true
            resetSilenceTimer()
        } catch {
            errorMessage = "Couldn't start the microphone."
            stop(fireSilence: false)
        }
    }

    /// Stops the engine and cancels the silence timer. `fireSilence` is
    /// used internally — callers should generally pass false.
    func stop(fireSilence: Bool = false) {
        silenceTimer?.invalidate()
        silenceTimer = nil

        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil

        isRecording = false
        amplitude = 0

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        if fireSilence { onSilence?() }
    }

    // MARK: Amplitude

    private func updateAmplitude(_ rms: Double) {
        // Smooth slightly so bars don't look jittery.
        amplitude = amplitude * 0.6 + rms * 0.4
        if rms > speechThreshold {
            resetSilenceTimer()
        }
    }

    private static func rmsAmplitude(from buffer: AVAudioPCMBuffer) -> Double {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let channelCount = Int(buffer.format.channelCount)
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return 0 }

        var sum: Double = 0
        for channel in 0..<channelCount {
            let data = channelData[channel]
            for i in 0..<frameLength {
                let sample = Double(data[i])
                sum += sample * sample
            }
        }
        let mean = sum / Double(channelCount * frameLength)
        let rms = sqrt(mean)
        // Boost — raw RMS on speech is tiny. Clamp to 0…1.
        return min(max(rms * 6, 0), 1)
    }

    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        let window = silenceWindow
        silenceTimer = Timer.scheduledTimer(withTimeInterval: window, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isRecording else { return }
                self.stop(fireSilence: true)
            }
        }
    }
}

// MARK: - Voice overlay UI

/// Full-width overlay anchored to the bottom of the screen. Surfaces the
/// live transcript, a 5-bar waveform that reacts to amplitude, and an
/// explicit "Done" button. Tapping the backdrop or swiping down dismisses.
struct VoiceModeOverlay: View {

    @Bindable var recognizer: VoiceRecognizer
    let onComplete: (String) -> Void
    let onDismiss: () -> Void

    @State private var dragOffset: CGFloat = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            // Backdrop — tap to dismiss.
            Color.black.opacity(0.35)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            VStack(spacing: 18) {
                // Drag indicator pill.
                Capsule()
                    .fill(Color.white.opacity(0.25))
                    .frame(width: 40, height: 4)
                    .padding(.top, 10)

                // Live transcript.
                Text(recognizer.transcript.isEmpty ? "\u{00A0}" : recognizer.transcript)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.70))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, 28)
                    .animation(.easeOut(duration: 0.12), value: recognizer.transcript)

                // Waveform.
                WaveformBars(amplitude: recognizer.amplitude)
                    .frame(height: 64)

                // Caption.
                Text(recognizer.errorMessage ?? "Listening\u{2026}")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(recognizer.errorMessage == nil ? 0.70 : 0.85))

                // Done button.
                Button {
                    complete()
                } label: {
                    Text("Done")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 26)
                        .padding(.vertical, 10)
                        .background {
                            Capsule().fill(BrettColors.gold)
                        }
                }
                .buttonStyle(.plain)
                .padding(.bottom, 14)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 26)
            .background {
                // Gold-tinted glass surface.
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .overlay(BrettColors.gold.opacity(0.08))
                    .overlay(alignment: .top) {
                        Rectangle()
                            .fill(BrettColors.gold.opacity(0.35))
                            .frame(height: 0.5)
                    }
                    .ignoresSafeArea(edges: .bottom)
            }
            .offset(y: max(dragOffset, 0))
            .gesture(
                DragGesture()
                    .onChanged { value in
                        dragOffset = value.translation.height
                    }
                    .onEnded { value in
                        if value.translation.height > 80 {
                            dismiss()
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) {
                                dragOffset = 0
                            }
                        }
                    }
            )
        }
        .transition(.opacity)
    }

    private func complete() {
        let text = recognizer.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        recognizer.stop(fireSilence: false)
        if !text.isEmpty {
            onComplete(text)
        } else {
            onDismiss()
        }
    }

    private func dismiss() {
        HapticManager.light()
        recognizer.stop(fireSilence: false)
        onDismiss()
    }
}

// MARK: - Waveform

/// 5-bar waveform. Each bar's height is modulated by the current amplitude
/// with a staggered phase so the group animates as a chorus rather than
/// marching in lockstep.
private struct WaveformBars: View {
    let amplitude: Double

    @State private var phase: Double = 0

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            ForEach(0..<5, id: \.self) { index in
                bar(at: index)
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }

    private func bar(at index: Int) -> some View {
        // Each bar has its own sine phase so the group breathes.
        let offset = Double(index) * 0.6
        let wave = (sin(phase + offset) + 1) / 2  // 0…1
        // Minimum floor so bars are still visible when silent.
        let floor = 0.18
        let magnitude = floor + (amplitude * 0.9 + wave * 0.3)
        let height = CGFloat(min(max(magnitude, floor), 1.0)) * 64
        return RoundedRectangle(cornerRadius: 3)
            .fill(
                LinearGradient(
                    colors: [
                        BrettColors.gold.opacity(0.9),
                        BrettColors.gold.opacity(0.55),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: 6, height: height)
            .shadow(color: BrettColors.gold.opacity(0.35), radius: 6, y: 0)
            .animation(.easeOut(duration: 0.12), value: amplitude)
    }
}
