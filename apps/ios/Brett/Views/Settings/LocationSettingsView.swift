import SwiftUI
import SwiftData
import CoreLocation

/// Assistant, memory, timezone, weather, and location preferences.
///
/// API endpoints:
/// - `PATCH /users/me`        — `{ assistantName }`
/// - `PATCH /users/timezone`  — `{ timezone, auto }`
/// - `PATCH /users/location`  — `{ city?, countryCode?, latitude?, longitude?, tempUnit?, weatherEnabled? }`
/// - `GET  /weather/geocode?q=query` — server-side city search
/// - `GET  /brett/memory/facts` — list of facts Brett has learned
/// - `DELETE /brett/memory/facts/:id` — delete a single fact
///
/// Briefing preference is local-only (`@AppStorage`).
///
/// Outer view is a thin auth gate: the body's `@Query` predicate needs a
/// concrete `userId`, so we resolve it from `AuthManager` and remount the
/// child via `.id(userId)` whenever the active user changes.
struct LocationSettingsView: View {
    @Environment(AuthManager.self) private var authManager

    let store: UserProfileStore
    let client: APIClient

    init(store: UserProfileStore, client: APIClient = .shared) {
        self.store = store
        self.client = client
    }

    var body: some View {
        if let userId = authManager.currentUser?.id {
            LocationSettingsBody(userId: userId, store: store, client: client)
                .id(userId)
        } else {
            EmptyView()
        }
    }
}

private struct LocationSettingsBody: View {
    let userId: String
    @Bindable var store: UserProfileStore

    // ── Assistant ──
    @State private var assistantName: String = "Brett"
    @State private var isAssistantNameSaving = false

    // ── Briefing ── scoped per-user; @State + explicit UserDefaults because
    // @AppStorage requires compile-time constant keys.
    @State private var briefingEnabled: Bool = true

    // ── Memory ──
    @State private var memoryFacts: [MemoryFact] = []
    @State private var isLoadingMemory = true
    @State private var memoryErrorMessage: String?
    @State private var factIdPendingConfirm: String?
    @State private var factIdDeleting: String?

    // ── Timezone ──
    @State private var timezoneAuto: Bool = true
    @State private var selectedTimezone: String = TimeZone.current.identifier
    @State private var searchText: String = ""

    // ── Weather & location ──
    @State private var weatherEnabled: Bool = true
    @State private var selectedTempUnit: TempUnit = .auto
    @State private var cityQuery: String = ""
    @State private var geocodeResults: [GeocodeCityResult] = []
    @State private var isSearching = false
    @State private var debounceTask: Task<Void, Never>?

    // ── General ──
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    @Query private var profiles: [UserProfile]
    private var currentProfile: UserProfile? { profiles.first }

    private let client: APIClient
    private let allTimezones: [String]

    init(userId: String, store: UserProfileStore, client: APIClient) {
        self.userId = userId
        self.store = store
        self.client = client
        self.allTimezones = TimeZone.knownTimeZoneIdentifiers.filter { $0.contains("/") }
        let predicate = #Predicate<UserProfile> { profile in
            profile.id == userId
        }
        _profiles = Query(filter: predicate, sort: \UserProfile.id)
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

            // ═══ Assistant ═══
            assistantSection

            // ═══ Memory ═══
            memorySection

            // ═══ Timezone ═══
            timezoneSection

            // ═══ Weather & Location ═══
            weatherLocationSection
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
        .task { await loadMemory() }
    }

    // MARK: - Assistant section

    @ViewBuilder
    private var assistantSection: some View {
        BrettSettingsSection("Assistant") {
            // Name field
            VStack(alignment: .leading, spacing: 6) {
                Text("Name your assistant")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)

                HStack(spacing: 10) {
                    TextField("Brett", text: $assistantName)
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .onChange(of: assistantName) { _, newValue in
                            // Enforce regex: alphanumeric + spaces + hyphens + apostrophes, max 10
                            let filtered = String(newValue.prefix(10)).filter { c in
                                c.isLetter || c.isNumber || c == " " || c == "-" || c == "'"
                            }
                            if filtered != newValue {
                                assistantName = filtered
                            }
                        }

                    // Live wordmark preview — matches desktop (LocationSection.tsx).
                    BrettWordmark(
                        name: assistantName.trimmingCharacters(in: .whitespaces).isEmpty
                            ? "Brett"
                            : assistantName,
                        size: 16
                    )

                    Text("\(assistantName.count)/10")
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textMeta)
                        .monospacedDigit()
                }

                Button {
                    Task { await saveAssistantName() }
                } label: {
                    HStack {
                        if isAssistantNameSaving {
                            ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                        }
                        Text(isAssistantNameSaving ? "Saving..." : "Save Name")
                            .font(BrettTypography.badge)
                            .foregroundStyle(BrettColors.gold)
                    }
                }
                .disabled(
                    isAssistantNameSaving
                    || assistantName.trimmingCharacters(in: .whitespaces).isEmpty
                    || assistantName.trimmingCharacters(in: .whitespaces) == (currentProfile?.assistantName ?? "Brett")
                )
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            BrettSettingsDivider()

            // Daily briefing toggle
            Toggle(isOn: $briefingEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daily briefing")
                        .foregroundStyle(BrettColors.textCardTitle)
                    Text("Show a morning summary on the Today page")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .tint(BrettColors.gold)
            .onChange(of: briefingEnabled) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: UserScopedStorage.key("briefing.enabled"))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Memory section

    @ViewBuilder
    private var memorySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrettSettingsSection("Memory") {
                if isLoadingMemory {
                    HStack {
                        Spacer()
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 16)
                } else if let memoryErrorMessage {
                    Text(memoryErrorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                } else if memoryFacts.isEmpty {
                    Text("No memories yet. Brett learns as you chat.")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                } else {
                    ForEach(Array(memoryFacts.enumerated()), id: \.element.id) { index, fact in
                        if index > 0 {
                            BrettSettingsDivider()
                        }
                        memoryRow(for: fact)
                    }
                }
            }

            Text("Brett stores facts it picks up from chat (preferences, habits, context). Tap the trash icon to forget one.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private func memoryRow(for fact: MemoryFact) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(fact.category.uppercased())
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(categoryColor(for: fact.category))

            HStack(alignment: .top, spacing: 10) {
                Text(fact.value)
                    .font(.system(size: 14))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if factIdPendingConfirm == fact.id {
                    HStack(spacing: 6) {
                        Button {
                            Task { await deleteFact(fact) }
                        } label: {
                            Text("Yes")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(BrettColors.error)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .fill(BrettColors.error.opacity(0.15))
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(factIdDeleting == fact.id)

                        Button {
                            factIdPendingConfirm = nil
                        } label: {
                            Text("Cancel")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(BrettColors.textCardTitle)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .fill(Color.white.opacity(0.08))
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(factIdDeleting == fact.id)
                    }
                } else {
                    Button {
                        factIdPendingConfirm = fact.id
                    } label: {
                        if factIdDeleting == fact.id {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(BrettColors.textMeta)
                                .frame(width: 16, height: 16)
                        } else {
                            Image(systemName: "trash")
                                .font(.system(size: 13))
                                .foregroundStyle(BrettColors.textMeta)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func categoryColor(for category: String) -> Color {
        switch category.lowercased() {
        case "preference":
            return BrettColors.gold
        case "context":
            return Color(red: 0.37, green: 0.83, blue: 0.77)
        case "relationship":
            return Color.purple.opacity(0.8)
        case "habit":
            return Color(red: 0.98, green: 0.75, blue: 0.14)
        default:
            return Color.white.opacity(0.40)
        }
    }

    // MARK: - Memory networking

    private func loadMemory() async {
        isLoadingMemory = true
        memoryErrorMessage = nil
        defer { isLoadingMemory = false }

        do {
            let response: MemoryFactsResponse = try await client.request(
                path: "/brett/memory/facts",
                method: "GET"
            )
            memoryFacts = response.facts
        } catch let apiError as APIError {
            memoryErrorMessage = apiError.userFacingMessage
        } catch {
            memoryErrorMessage = "Couldn't load memories."
        }
    }

    private func deleteFact(_ fact: MemoryFact) async {
        factIdDeleting = fact.id
        defer {
            factIdDeleting = nil
            factIdPendingConfirm = nil
        }

        do {
            struct GenericResponse: Decodable {}
            let _: GenericResponse = try await client.request(
                path: "/brett/memory/facts/\(fact.id)",
                method: "DELETE"
            )
            memoryFacts.removeAll { $0.id == fact.id }
        } catch let apiError as APIError {
            memoryErrorMessage = apiError.userFacingMessage
        } catch {
            memoryErrorMessage = "Couldn't remove that memory."
        }
    }

    // MARK: - Timezone section

    @ViewBuilder
    private var timezoneSection: some View {
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
    }

    // MARK: - Weather & Location section

    @ViewBuilder
    private var weatherLocationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrettSettingsSection("Weather & Location") {
                // Weather toggle
                Toggle(isOn: $weatherEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show weather")
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text("Display weather conditions in your briefing")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
                .tint(BrettColors.gold)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                if weatherEnabled {
                    BrettSettingsDivider()

                    // Temperature unit picker
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Temperature unit")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)

                        Picker("Temperature", selection: $selectedTempUnit) {
                            Text("Auto").tag(TempUnit.auto)
                            Text("\u{00B0}C").tag(TempUnit.c)
                            Text("\u{00B0}F").tag(TempUnit.f)
                        }
                        .pickerStyle(.segmented)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)

                    BrettSettingsDivider()

                    // City search
                    VStack(alignment: .leading, spacing: 8) {
                        if let city = currentProfile?.city, !city.isEmpty {
                            HStack(spacing: 6) {
                                Image(systemName: "mappin.and.ellipse")
                                    .font(.system(size: 12))
                                    .foregroundStyle(BrettColors.gold)
                                Text(city)
                                    .font(BrettTypography.taskMeta)
                                    .foregroundStyle(BrettColors.textCardTitle)
                            }
                        }

                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 13))
                                .foregroundStyle(BrettColors.textMeta)

                            TextField("Search city\u{2026}", text: $cityQuery)
                                .foregroundStyle(.white)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .onChange(of: cityQuery) { _, newValue in
                                    debouncedCitySearch(newValue)
                                }

                            if isSearching {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .scaleEffect(0.7)
                                    .tint(BrettColors.gold)
                            }
                        }

                        // Search results
                        if !geocodeResults.isEmpty {
                            VStack(spacing: 0) {
                                ForEach(Array(geocodeResults.enumerated()), id: \.offset) { index, result in
                                    if index > 0 {
                                        Rectangle()
                                            .fill(Color.white.opacity(0.06))
                                            .frame(height: 0.5)
                                    }
                                    Button {
                                        selectCity(result)
                                    } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: "mappin")
                                                .font(.system(size: 11))
                                                .foregroundStyle(BrettColors.textMeta)
                                            Text(result.displayName)
                                                .font(BrettTypography.taskMeta)
                                                .foregroundStyle(BrettColors.textCardTitle)
                                                .lineLimit(1)
                                            Spacer()
                                        }
                                        .padding(.vertical, 8)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 4)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }

            Text("Search for your city to set location and weather. Coordinates are stored for weather and travel-time features.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 4)
        }
    }

    // MARK: - Timezone picker

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

    // MARK: - City search

    private func debouncedCitySearch(_ query: String) {
        debounceTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            geocodeResults = []
            return
        }
        debounceTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await searchCity(trimmed)
        }
    }

    private func searchCity(_ query: String) async {
        isSearching = true
        defer { isSearching = false }

        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        do {
            let response: GeocodeCityResponse = try await client.requestRelative(
                relativePath: "/weather/geocode?q=\(encoded)",
                method: "GET"
            )
            geocodeResults = response.results
        } catch {
            geocodeResults = []
        }
    }

    private func selectCity(_ result: GeocodeCityResult) {
        cityQuery = ""
        geocodeResults = []

        Task {
            do {
                struct LocationPayload: Encodable {
                    let city: String
                    let countryCode: String
                    let latitude: Double
                    let longitude: Double
                }
                struct GenericResponse: Decodable {}
                let _: GenericResponse = try await client.request(
                    path: "/users/location",
                    method: "PATCH",
                    body: LocationPayload(
                        city: result.name,
                        countryCode: result.countryCode,
                        latitude: result.latitude,
                        longitude: result.longitude
                    )
                )

                // Update the timezone if a timezone came back and auto is off
                if !timezoneAuto, !result.timezone.isEmpty {
                    selectedTimezone = result.timezone
                }

                // Refresh profile to pick up new city
                await refreshProfile()
                successMessage = "Location updated."
                clearMessagesAfterDelay()
            } catch let apiError as APIError {
                errorMessage = apiError.userFacingMessage
            } catch {
                errorMessage = "Couldn't save location."
            }
        }
    }

    // MARK: - Hydrate

    private func hydrate() {
        // Read the scoped briefing pref even when the user profile hasn't
        // loaded yet — default to true (matches the old @AppStorage default).
        let key = UserScopedStorage.key("briefing.enabled")
        briefingEnabled = UserDefaults.standard.object(forKey: key) as? Bool ?? true

        guard let profile = currentProfile else { return }
        assistantName = profile.assistantName
        timezoneAuto = profile.timezoneAuto
        selectedTimezone = profile.timezone
        weatherEnabled = profile.weatherEnabled
        selectedTempUnit = Self.tempUnitFromAPI(profile.tempUnit)
    }

    // MARK: - Save (toolbar button)

    private func save() async {
        isSaving = true
        errorMessage = nil
        successMessage = nil
        defer { isSaving = false }

        do {
            try await saveTimezone()
            try await saveWeatherLocation()
            successMessage = "Saved."
            clearMessagesAfterDelay()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't save preferences."
        }
    }

    // MARK: - Save assistant name

    private func saveAssistantName() async {
        let trimmed = assistantName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        guard trimmed != (currentProfile?.assistantName ?? "Brett") else { return }

        isAssistantNameSaving = true
        errorMessage = nil
        defer { isAssistantNameSaving = false }

        do {
            struct Payload: Encodable { let assistantName: String }
            struct GenericResponse: Decodable {}
            let _: GenericResponse = try await client.request(
                path: "/users/me",
                method: "PATCH",
                body: Payload(assistantName: trimmed)
            )
            await refreshProfile()
            successMessage = "Assistant name updated."
            clearMessagesAfterDelay()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't update assistant name."
        }
    }

    // MARK: - Save timezone

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

    // MARK: - Save weather & location

    private func saveWeatherLocation() async throws {
        struct LocationPayload: Encodable {
            let weatherEnabled: Bool
            let tempUnit: String
        }
        struct GenericResponse: Decodable {}
        let _: GenericResponse = try await client.request(
            path: "/users/location",
            method: "PATCH",
            body: LocationPayload(
                weatherEnabled: weatherEnabled,
                tempUnit: Self.tempUnitToAPI(selectedTempUnit)
            )
        )
    }

    // MARK: - Temp unit mapping
    //
    // iOS enum: .auto / .c / .f
    // API values: "auto" / "celsius" / "fahrenheit"

    private static func tempUnitFromAPI(_ raw: String) -> TempUnit {
        switch raw {
        case "fahrenheit": return .f
        case "celsius": return .c
        case "auto": return .auto
        default:
            // Try enum raw value as fallback (handles "c", "f")
            return TempUnit(rawValue: raw) ?? .auto
        }
    }

    private static func tempUnitToAPI(_ unit: TempUnit) -> String {
        switch unit {
        case .auto: return "auto"
        case .c: return "celsius"
        case .f: return "fahrenheit"
        }
    }

    // MARK: - Profile refresh

    private func refreshProfile() async {
        struct UserMeResponse: Decodable {
            let id: String
            let email: String
            let name: String?
            let image: String?
            let assistantName: String?
            let timezone: String?
            let timezoneAuto: Bool?
            let city: String?
            let countryCode: String?
            let tempUnit: String?
            let weatherEnabled: Bool?
            let backgroundStyle: String?
            let pinnedBackground: String?
            let avgBusynessScore: Double?
        }

        do {
            let response: UserMeResponse = try await client.request(
                path: "/users/me",
                method: "GET"
            )
            // Build a dictionary to match UserProfileStore.update(from:)
            var payload: [String: Any] = [
                "id": response.id,
                "email": response.email,
            ]
            if let name = response.name { payload["name"] = name }
            if let image = response.image { payload["image"] = image }
            if let an = response.assistantName { payload["assistantName"] = an }
            if let tz = response.timezone { payload["timezone"] = tz }
            if let tza = response.timezoneAuto { payload["timezoneAuto"] = tza }
            if let city = response.city { payload["city"] = city }
            if let cc = response.countryCode { payload["countryCode"] = cc }
            if let tu = response.tempUnit { payload["tempUnit"] = tu }
            if let we = response.weatherEnabled { payload["weatherEnabled"] = we }
            if let bs = response.backgroundStyle { payload["backgroundStyle"] = bs }
            payload["pinnedBackground"] = response.pinnedBackground as Any
            if let abs = response.avgBusynessScore { payload["avgBusynessScore"] = abs }

            store.update(from: payload)
        } catch {
            // Silent — we already showed a success or error for the mutation itself.
        }
    }

    // MARK: - CoreLocation fallback geocoding

    private struct CoreLocationResult {
        let latitude: Double
        let longitude: Double
        let locality: String?
    }

    private func geocodeFallback(_ address: String) async throws -> CoreLocationResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CoreLocationResult, Error>) in
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
                continuation.resume(returning: CoreLocationResult(
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    locality: place.locality
                ))
            }
        }
    }

    // MARK: - Helpers

    private func clearMessagesAfterDelay() {
        Task {
            try? await Task.sleep(for: .seconds(3))
            successMessage = nil
            errorMessage = nil
        }
    }
}

// MARK: - Geocode response models

private struct GeocodeCityResponse: Decodable {
    let results: [GeocodeCityResult]
}

private struct GeocodeCityResult: Decodable {
    let name: String
    let state: String?
    let country: String
    let countryCode: String
    let latitude: Double
    let longitude: Double
    let timezone: String
    let displayName: String
}

// MARK: - Memory response models

private struct MemoryFactsResponse: Decodable {
    let facts: [MemoryFact]
}

private struct MemoryFact: Decodable, Identifiable {
    let id: String
    let category: String
    let key: String?
    let value: String
    let confidence: Double?
    let sourceType: String?
    let validFrom: Date?
    let createdAt: Date?
    let updatedAt: Date?
}
