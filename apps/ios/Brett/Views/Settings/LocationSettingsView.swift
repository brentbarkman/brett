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
        BrettSettingsScroll {
            if let errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            if let successMessage {
                BrettSettingsSection {
                    Text(successMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.success)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            BrettSettingsSection("Timezone") {
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
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                if !timezoneAuto {
                    BrettSettingsDivider()

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
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.30))
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                BrettSettingsSection("Locations") {
                    TextField("Home address", text: $homeAddress, axis: .vertical)
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.words)
                        .lineLimit(1...3)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)

                    BrettSettingsDivider()

                    TextField("Work address", text: $workAddress, axis: .vertical)
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.words)
                        .lineLimit(1...3)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }

                Text("Addresses are geocoded once when you tap Save. We only store the coordinates for travel-time features.")
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.textMeta)
                    .padding(.horizontal, 4)
            }
        }
        .navigationTitle("Timezone & Location")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
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
                        .brettSettingsRowBackground()
                    }
                }
            }
            .brettSettingsForm()
            .searchable(text: $searchText, prompt: "Search timezones")
        }
        .navigationTitle("Timezone")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var filteredTimezones: [String] {
        guard !searchText.isEmpty else { return allTimezones }
        return allTimezones.filter { $0.localizedCaseInsensitiveContains(searchText) }
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
