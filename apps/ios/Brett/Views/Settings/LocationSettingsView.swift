import SwiftUI
import CoreLocation

/// Timezone + location preferences.
///
/// Timezone is persisted via `PATCH /users/timezone` (accepts `timezone` and
/// `auto`). Home/work addresses go through `PATCH /users/location` along
/// with lat/lng from CoreLocation geocoding.
///
/// Geocoding happens on-demand when the user taps "Save" — not on every
/// keystroke — to avoid hammering the geocoder.
struct LocationSettingsView: View {
    @Bindable var store: UserProfileStore

    @State private var timezoneAuto: Bool = true
    @State private var selectedTimezone: String = TimeZone.current.identifier
    @State private var homeAddress: String = ""
    @State private var workAddress: String = ""
    @State private var searchText: String = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private let client: APIClient
    private let allTimezones: [String]

    init(store: UserProfileStore, client: APIClient = .shared) {
        self.store = store
        self.client = client
        self.allTimezones = TimeZone.knownTimeZoneIdentifiers.filter { $0.contains("/") }
    }

    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.error)
                            .listRowBackground(glassRowBackground)
                    }
                }

                if let successMessage {
                    Section {
                        Text(successMessage)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.success)
                            .listRowBackground(glassRowBackground)
                    }
                }

                Section {
                    Toggle(isOn: $timezoneAuto) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Auto-detect")
                                .foregroundStyle(BrettColors.textCardTitle)
                            Text("Use the device's current timezone")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }
                    }
                    .tint(BrettColors.gold)
                    .listRowBackground(glassRowBackground)

                    if !timezoneAuto {
                        NavigationLink {
                            timezonePickerScreen
                        } label: {
                            HStack {
                                Text("Timezone")
                                    .foregroundStyle(BrettColors.textCardTitle)
                                Spacer()
                                Text(selectedTimezone)
                                    .foregroundStyle(BrettColors.textMeta)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        .listRowBackground(glassRowBackground)
                    }
                } header: {
                    sectionHeader("Timezone")
                }

                Section {
                    TextField("Home address", text: $homeAddress, axis: .vertical)
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.words)
                        .lineLimit(1...3)
                        .listRowBackground(glassRowBackground)

                    TextField("Work address", text: $workAddress, axis: .vertical)
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.words)
                        .lineLimit(1...3)
                        .listRowBackground(glassRowBackground)
                } header: {
                    sectionHeader("Locations")
                } footer: {
                    Text("Addresses are geocoded once when you tap Save. We only store the coordinates for travel-time features.")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Timezone & Location")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                    } else {
                        Text("Save")
                            .foregroundStyle(BrettColors.gold)
                            .fontWeight(.semibold)
                    }
                }
                .disabled(isSaving)
            }
        }
        .onAppear { hydrate() }
    }

    @ViewBuilder
    private var timezonePickerScreen: some View {
        ZStack {
            BackgroundView()
            Form {
                Section {
                    ForEach(filteredTimezones, id: \.self) { tz in
                        Button {
                            selectedTimezone = tz
                        } label: {
                            HStack {
                                Text(tz)
                                    .foregroundStyle(BrettColors.textCardTitle)
                                Spacer()
                                if tz == selectedTimezone {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(BrettColors.gold)
                                }
                            }
                        }
                        .listRowBackground(glassRowBackground)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .searchable(text: $searchText, prompt: "Search timezones")
        }
        .navigationTitle("Timezone")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var filteredTimezones: [String] {
        guard !searchText.isEmpty else { return allTimezones }
        return allTimezones.filter { $0.localizedCaseInsensitiveContains(searchText) }
    }

    @ViewBuilder
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }

    private func hydrate() {
        guard let profile = store.current else { return }
        timezoneAuto = profile.timezoneAuto
        selectedTimezone = profile.timezone
        homeAddress = UserDefaults.standard.string(forKey: "settings.location.home") ?? ""
        workAddress = UserDefaults.standard.string(forKey: "settings.location.work") ?? ""
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        successMessage = nil
        defer { isSaving = false }

        do {
            try await saveTimezone()
            try await saveLocationIfChanged()
            successMessage = "Saved."
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't save preferences."
        }
    }

    private func saveTimezone() async throws {
        struct Payload: Encodable { let timezone: String; let auto: Bool }
        let effective = timezoneAuto ? TimeZone.current.identifier : selectedTimezone
        struct GenericResponse: Decodable {}
        let _: GenericResponse = try await client.request(
            path: "/users/timezone",
            method: "PATCH",
            body: Payload(timezone: effective, auto: timezoneAuto)
        )
    }

    private func saveLocationIfChanged() async throws {
        let homeTrimmed = homeAddress.trimmingCharacters(in: .whitespaces)
        let workTrimmed = workAddress.trimmingCharacters(in: .whitespaces)

        UserDefaults.standard.set(homeTrimmed, forKey: "settings.location.home")
        UserDefaults.standard.set(workTrimmed, forKey: "settings.location.work")

        guard !homeTrimmed.isEmpty else { return }

        let coord = try await geocode(homeTrimmed)

        struct LocationPayload: Encodable {
            let city: String?
            let latitude: Double
            let longitude: Double
        }
        struct GenericResponse: Decodable {}
        let _: GenericResponse = try await client.request(
            path: "/users/location",
            method: "PATCH",
            body: LocationPayload(
                city: coord.locality,
                latitude: coord.latitude,
                longitude: coord.longitude
            )
        )
    }

    private struct GeocodeResult {
        let latitude: Double
        let longitude: Double
        let locality: String?
    }

    private func geocode(_ address: String) async throws -> GeocodeResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<GeocodeResult, Error>) in
            CLGeocoder().geocodeAddressString(address) { placemarks, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let place = placemarks?.first,
                      let coord = place.location?.coordinate else {
                    continuation.resume(throwing: APIError.validation("Couldn't resolve that address."))
                    return
                }
                continuation.resume(returning: GeocodeResult(
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    locality: place.locality
                ))
            }
        }
    }
}
