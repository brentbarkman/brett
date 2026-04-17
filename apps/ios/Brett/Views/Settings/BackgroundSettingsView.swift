import SwiftUI

/// Background picker — iOS counterpart to the desktop `BackgroundSection`.
///
/// Three tabs: Photography / Abstract / Solid. Each tab shows a
/// "Smart Rotation" pill that clears `pinnedBackground` and sets
/// `backgroundStyle` to the viewing style, plus a gallery of taps that
/// pin a specific image or color.
///
/// Writes flow through `PATCH /users/location` with only the changed
/// fields. After the mutation lands we re-fetch `/users/me` so the
/// `UserProfileStore` (and therefore the live `BackgroundView`)
/// updates immediately.
struct BackgroundSettingsView: View {
    @Bindable var store: UserProfileStore

    private let client: APIClient

    init(store: UserProfileStore? = nil, client: APIClient = .shared) {
        self.store = store ?? UserProfileStore()
        self.client = client
    }

    // MARK: - State

    /// The style currently being browsed. Doesn't save until the user
    /// taps Smart Rotation or an image.
    @State private var viewingStyle: BackgroundService.Style = .photography

    /// What the server currently has. Mirrors the user profile and
    /// drives the "active" / "pinned" indicators.
    @State private var activeStyle: BackgroundService.Style = .photography
    @State private var pinnedValue: String?

    @State private var service = BackgroundService.shared

    @State private var isSaving = false
    @State private var errorMessage: String?

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

            tabsSection

            BrettSettingsSection("Smart Rotation") {
                smartRotationRow
            }

            gallerySection
        }
        .navigationTitle("Background")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            await service.load()
            hydrateFromProfile()
        }
        .onAppear {
            hydrateFromProfile()
        }
    }

    // MARK: - Tabs

    @ViewBuilder
    private var tabsSection: some View {
        BrettSettingsCard {
            HStack(spacing: 0) {
                ForEach(BackgroundService.Style.allCases, id: \.self) { style in
                    tab(for: style)
                    if style != BackgroundService.Style.allCases.last {
                        Rectangle()
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 0.5, height: 28)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func tab(for style: BackgroundService.Style) -> some View {
        let isActive = viewingStyle == style
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                viewingStyle = style
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: iconName(for: style))
                    .font(.system(size: 13, weight: .medium))
                Text(style.display)
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(isActive ? BrettColors.gold : Color.white.opacity(0.55))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .background(
                isActive ? BrettColors.gold.opacity(0.10) : Color.clear,
                in: Rectangle()
            )
        }
        .buttonStyle(.plain)
    }

    private func iconName(for style: BackgroundService.Style) -> String {
        switch style {
        case .photography: return "photo"
        case .abstract: return "sparkles"
        case .solid: return "circle.fill"
        }
    }

    // MARK: - Smart Rotation

    @ViewBuilder
    private var smartRotationRow: some View {
        let isActive = activeStyle == viewingStyle && pinnedValue == nil
        Button {
            Task { await applySmart() }
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill((isActive ? BrettColors.gold : Color.white).opacity(isActive ? 0.15 : 0.08))
                        .frame(width: 30, height: 30)
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(isActive ? BrettColors.gold : Color.white.opacity(0.65))
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("Smart Rotation")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        if isActive {
                            Text("Active")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(BrettColors.gold)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule().fill(BrettColors.gold.opacity(0.12))
                                )
                        }
                    }
                    Text("Shifts with time of day")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
                Spacer()
                if isSaving {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(BrettColors.gold)
                        .padding(.trailing, 14)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    // MARK: - Gallery

    @ViewBuilder
    private var gallerySection: some View {
        switch viewingStyle {
        case .photography, .abstract:
            imageGallery(for: viewingStyle)
        case .solid:
            solidGallery
        }
    }

    @ViewBuilder
    private func imageGallery(for style: BackgroundService.Style) -> some View {
        if let manifest = service.manifest, service.storageBaseUrl != nil {
            let segments = BackgroundService.segments(for: style, in: manifest)

            ForEach(BackgroundService.Segment.allCases) { segment in
                BrettSettingsSection(segment.label) {
                    imageGrid(segment: segment, segments: segments)
                }
            }
        } else {
            BrettSettingsSection {
                HStack {
                    Spacer()
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(BrettColors.gold)
                    Spacer()
                }
                .padding(.vertical, 24)
            }
        }
    }

    @ViewBuilder
    private func imageGrid(
        segment: BackgroundService.Segment,
        segments: BackgroundService.BackgroundManifest.Segments
    ) -> some View {
        let tier = BackgroundService.tier(for: segment, in: segments)
        // Flatten tiers — the iOS picker shows every image for the
        // segment at once, grouped only by time-of-day. The "busyness"
        // axis is a desktop-only distinction for now.
        let paths: [String] = tier.light + tier.moderate + tier.packed

        let columns: [GridItem] = [
            GridItem(.flexible(), spacing: 8),
            GridItem(.flexible(), spacing: 8),
        ]

        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(paths, id: \.self) { path in
                imageThumbnail(path: path)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func imageThumbnail(path: String) -> some View {
        let isPinned = pinnedValue == path
        let url = service.url(for: path)

        Button {
            Task { await applyPin(path: path) }
        } label: {
            ZStack(alignment: .topTrailing) {
                GeometryReader { geo in
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                        case .failure:
                            Color.black.opacity(0.4)
                        default:
                            ZStack {
                                Color.black.opacity(0.3)
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .tint(Color.white.opacity(0.6))
                                    .scaleEffect(0.7)
                            }
                        }
                    }
                }
                .aspectRatio(16.0 / 10.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            isPinned ? BrettColors.gold.opacity(0.85) : Color.white.opacity(0.12),
                            lineWidth: isPinned ? 2 : 0.5
                        )
                }

                if isPinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(5)
                        .background(Circle().fill(BrettColors.gold.opacity(0.85)))
                        .padding(6)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    @ViewBuilder
    private var solidGallery: some View {
        BrettSettingsSection("Colors") {
            let columns: [GridItem] = Array(
                repeating: GridItem(.flexible(), spacing: 8),
                count: 4
            )

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(BackgroundService.solidColors) { solid in
                    solidCell(for: solid)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 12)
        }
    }

    @ViewBuilder
    private func solidCell(for solid: BackgroundService.SolidColor) -> some View {
        let isPinned = pinnedValue == solid.pinnedValue
        Button {
            Task { await applyPin(path: solid.pinnedValue) }
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .fill(solid.color)
                        .frame(width: 44, height: 44)
                        .overlay(
                            Circle()
                                .strokeBorder(
                                    isPinned ? BrettColors.gold.opacity(0.85) : Color.white.opacity(0.12),
                                    lineWidth: isPinned ? 2 : 0.5
                                )
                        )
                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(4)
                            .background(Circle().fill(BrettColors.gold.opacity(0.85)))
                            .offset(x: 16, y: -16)
                    }
                }
                Text(solid.label)
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.textMeta)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    // MARK: - Hydrate

    private func hydrateFromProfile() {
        guard let profile = store.current else { return }
        let style = BackgroundService.Style(rawValue: profile.backgroundStyle) ?? .photography
        activeStyle = style
        viewingStyle = style
        pinnedValue = profile.pinnedBackground
    }

    // MARK: - Save

    private func applySmart() async {
        let style = viewingStyle
        await save(style: style, pinned: nil)
    }

    private func applyPin(path: String) async {
        let style = viewingStyle
        await save(style: style, pinned: path)
    }

    private func save(style: BackgroundService.Style, pinned: String?) async {
        guard !isSaving else { return }

        isSaving = true
        errorMessage = nil

        // Optimistic UI — update the local indicators immediately so
        // the pinned outline / "Active" badge reflects the tap without
        // waiting for the round-trip.
        let previousStyle = activeStyle
        let previousPinned = pinnedValue
        activeStyle = style
        pinnedValue = pinned

        do {
            try await patchLocation(style: style, pinned: pinned)
            await refreshProfile()
        } catch let apiError as APIError {
            activeStyle = previousStyle
            pinnedValue = previousPinned
            errorMessage = apiError.userFacingMessage
        } catch {
            activeStyle = previousStyle
            pinnedValue = previousPinned
            errorMessage = "Couldn't save background."
        }

        isSaving = false
    }

    private func patchLocation(style: BackgroundService.Style, pinned: String?) async throws {
        // PATCH /users/location accepts only the fields we send, so we
        // build a custom encoder that emits a literal `null` for
        // `pinnedBackground` when clearing the pin. A plain Encodable
        // struct with an optional would omit the key on nil.
        struct Payload: Encodable {
            let backgroundStyle: String
            let pinnedBackground: String?

            enum CodingKeys: String, CodingKey {
                case backgroundStyle
                case pinnedBackground
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(backgroundStyle, forKey: .backgroundStyle)
                // Emit `null` (not omitted) so the server clears the
                // pin. `encodeIfPresent` would swallow the nil.
                if let pinnedBackground {
                    try container.encode(pinnedBackground, forKey: .pinnedBackground)
                } else {
                    try container.encodeNil(forKey: .pinnedBackground)
                }
            }
        }

        struct Empty: Decodable {}
        let _: Empty = try await client.request(
            Empty.self,
            path: "/users/location",
            method: "PATCH",
            body: Payload(backgroundStyle: style.rawValue, pinnedBackground: pinned)
        )
    }

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
                UserMeResponse.self,
                path: "/users/me",
                method: "GET"
            )
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
            hydrateFromProfile()
        } catch {
            // Non-fatal — the optimistic update already painted the UI,
            // and the next /users/me fetch (from another screen) will
            // eventually reconcile.
        }
    }
}
