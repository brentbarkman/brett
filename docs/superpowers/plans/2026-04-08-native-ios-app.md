# Brett Native iOS App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native SwiftUI iOS app for Brett with mock data, production-quality UI, ready for API integration later.

**Architecture:** SwiftUI app using MVVM with `@Observable` view models. Three-page horizontal navigation (Inbox/Today/Calendar) with a persistent omnibar. Glass cards over living background photography. SwiftData models defined but wired to mock data for now. All screens are production UI — mock data swaps for real sync later.

**Tech Stack:** Swift 6, SwiftUI (iOS 26+), SwiftData, Observation framework (`@Observable`), Swift Testing

**Spec:** `docs/superpowers/specs/2026-04-08-native-ios-redesign.md`

**Scope:** This plan covers Phase 1 (scaffolding) and Phase 2 (UI prototype with mock data). Phase 3 (sync engine, API integration, widgets, Siri) is a separate plan.

---

## File Structure

```
apps/ios/
├── Brett.xcodeproj/
├── Brett/
│   ├── BrettApp.swift                    # App entry point, scene setup
│   ├── Info.plist
│   ├── Assets.xcassets/                  # App icon, colors, background images
│   │   ├── AppIcon.appiconset/
│   │   ├── Colors/                       # Named colors (Gold, Cerulean, etc.)
│   │   └── Backgrounds/                  # Living background images
│   ├── Models/
│   │   ├── Item.swift                    # SwiftData @Model for tasks/content
│   │   ├── ItemList.swift                # SwiftData @Model for lists (avoiding `List` name collision)
│   │   ├── CalendarEvent.swift           # SwiftData @Model for events
│   │   ├── Scout.swift                   # SwiftData @Model for scouts
│   │   ├── ScoutFinding.swift            # SwiftData @Model for findings
│   │   ├── BrettMessage.swift            # SwiftData @Model for chat messages
│   │   ├── Attachment.swift              # SwiftData @Model for file attachments
│   │   ├── UserProfile.swift             # SwiftData @Model for user profile
│   │   └── Enums.swift                   # Shared enums (ItemStatus, ItemType, Urgency, etc.)
│   ├── Mock/
│   │   ├── MockData.swift                # Static mock fixtures (items, lists, events, scouts)
│   │   └── MockStore.swift               # Observable mock store with CRUD operations
│   ├── Theme/
│   │   ├── BrettColors.swift             # Color constants (gold, cerulean, semantic)
│   │   ├── BrettTypography.swift         # Font styles, Dynamic Type support
│   │   └── GlassCard.swift               # Reusable glass card modifier/view
│   ├── Views/
│   │   ├── MainContainer.swift           # Root: 3-page TabView + omnibar overlay
│   │   ├── Today/
│   │   │   ├── TodayPage.swift           # Today page content
│   │   │   ├── DayHeader.swift           # Date + stats, floating on background
│   │   │   ├── DailyBriefing.swift       # Cerulean-tinted briefing card
│   │   │   └── TaskSection.swift         # Glass card containing grouped task rows
│   │   ├── Inbox/
│   │   │   └── InboxPage.swift           # Inbox page content
│   │   ├── Calendar/
│   │   │   ├── CalendarPage.swift        # Calendar page content
│   │   │   ├── WeekStrip.swift           # Horizontal week selector
│   │   │   └── DayTimeline.swift         # Vertical hourly timeline with events
│   │   ├── Shared/
│   │   │   ├── TaskRow.swift             # Single task row (checkbox + title + meta)
│   │   │   ├── GoldCheckbox.swift        # Animated gold checkbox
│   │   │   ├── BackgroundView.swift      # Living background with vignette
│   │   │   ├── PageIndicator.swift       # Subtle dot indicators for 3 pages
│   │   │   └── EmptyState.swift          # Reusable empty state (heading + copy)
│   │   ├── Omnibar/
│   │   │   ├── OmnibarView.swift         # Glass pill, text input, mic, list drawer trigger
│   │   │   ├── VoiceMode.swift           # Expanded voice mode with waveform
│   │   │   └── ListDrawer.swift          # Half-sheet with list pills
│   │   ├── Detail/
│   │   │   ├── TaskDetailView.swift      # Full task detail (push)
│   │   │   ├── EventDetailView.swift     # Calendar event detail (push)
│   │   │   └── ListDetailView.swift      # Filtered list view (push)
│   │   ├── Settings/
│   │   │   └── SettingsView.swift        # Grouped inset list settings
│   │   └── Auth/
│   │       └── SignInView.swift          # Sign-in screen
│   └── Utilities/
│       ├── DateHelpers.swift             # Date formatting, urgency computation, relative dates
│       ├── HapticManager.swift           # Centralized haptic feedback
│       └── KeychainManager.swift         # Keychain read/write/delete for auth tokens
├── BrettTests/
│   ├── DateHelpersTests.swift
│   ├── MockStoreTests.swift
│   └── EnumsTests.swift
└── BrettUITests/
    └── NavigationTests.swift
```

---

## Task 1: Xcode Project Setup

**Files:**
- Create: `apps/ios/` (entire Xcode project via `xcodebuild` or Xcode template)
- Create: `apps/ios/Brett/BrettApp.swift`
- Create: `apps/ios/Brett/Info.plist`

- [ ] **Step 1: Create the Xcode project**

Create a new SwiftUI app project at `apps/ios/` with:
- Product name: `Brett`
- Bundle identifier: `com.brett.app`
- Organization: Brett
- Interface: SwiftUI
- Language: Swift
- Storage: SwiftData
- Testing: Swift Testing
- Minimum deployment: iOS 18.0 (latest stable; iOS 26 beta not yet shippable)
- App Group capability: `group.com.brett.app`

Use `xcodebuild` or create manually. The project must live at `apps/ios/Brett.xcodeproj`.

- [ ] **Step 2: Configure Info.plist**

Add to Info.plist:
```xml
<key>NSFaceIDUsageDescription</key>
<string>Unlock Brett with Face ID</string>
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>remote-notification</string>
</array>
<key>UIUserInterfaceStyle</key>
<string>Dark</string>
```

The `UIUserInterfaceStyle = Dark` forces dark mode always (design requirement).

- [ ] **Step 3: Set up BrettApp.swift entry point**

```swift
import SwiftUI
import SwiftData

@main
struct BrettApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: []) // Empty for now, models added in Task 3
    }
}

struct ContentView: View {
    var body: some View {
        Text("Brett")
            .font(.largeTitle.bold())
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black)
    }
}
```

- [ ] **Step 4: Build and run on simulator**

```bash
cd apps/ios
xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Verify on simulator**

```bash
xcrun simctl install "iPhone 17 Pro" $(find ~/Library/Developer/Xcode/DerivedData -name "Brett.app" -path "*/Debug-iphonesimulator/*" | head -1)
xcrun simctl launch "iPhone 17 Pro" com.brett.app
sleep 3
xcrun simctl io "iPhone 17 Pro" screenshot /tmp/brett-native-setup.png
```

Expected: Black screen with "Brett" text centered.

- [ ] **Step 6: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): initialize native SwiftUI project"
```

---

## Task 2: Theme System (Colors, Typography, Glass)

**Files:**
- Create: `apps/ios/Brett/Theme/BrettColors.swift`
- Create: `apps/ios/Brett/Theme/BrettTypography.swift`
- Create: `apps/ios/Brett/Theme/GlassCard.swift`
- Create: `apps/ios/Brett/Assets.xcassets/Colors/`

- [ ] **Step 1: Create BrettColors.swift**

```swift
import SwiftUI

enum BrettColors {
    // Brand
    static let gold = Color(red: 232/255, green: 185/255, blue: 49/255)       // #E8B931
    static let cerulean = Color(red: 70/255, green: 130/255, blue: 195/255)   // #4682C3

    // Semantic
    static let success = Color(red: 72/255, green: 187/255, blue: 160/255)    // #48BBA0
    static let error = Color(red: 230/255, green: 85/255, blue: 75/255)       // #E6554B

    // Text (white at varying opacity)
    static let textPrimary = Color.white.opacity(0.85)
    static let textSecondary = Color.white.opacity(0.40)
    static let textTertiary = Color.white.opacity(0.25)
    static let textGhost = Color.white.opacity(0.15)

    // Surfaces
    static let hairline = Color.white.opacity(0.05)
    static let cardBorder = Color.white.opacity(0.08)

    // Section label variants
    static let goldLabel = gold.opacity(0.50)
    static let ceruleanLabel = cerulean.opacity(0.60)

    /// Initialize Color from hex string (e.g. "#3B82F6" or "3B82F6")
    static func fromHex(_ hex: String) -> Color? {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return nil
        }
        return Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
```

- [ ] **Step 2: Create BrettTypography.swift**

```swift
import SwiftUI

enum BrettTypography {
    // Headers
    static let dateHeader: Font = .system(size: 28, weight: .bold)
    static let sectionTitle: Font = .system(size: 18, weight: .semibold)

    // Labels
    static let sectionLabel: Font = .system(size: 11, weight: .semibold).uppercaseSmallCaps()

    // Content
    static let taskTitle: Font = .system(size: 16, weight: .medium)
    static let taskMeta: Font = .system(size: 12, weight: .regular)
    static let body: Font = .system(size: 14, weight: .regular)
    static let stats: Font = .system(size: 13, weight: .regular)

    // Omnibar
    static let omnibarPlaceholder: Font = .system(size: 16, weight: .regular)

    // Empty states
    static let emptyHeading: Font = .system(size: 26, weight: .bold)
    static let emptyCopy: Font = .system(size: 15, weight: .regular)

    // Detail
    static let detailTitle: Font = .system(size: 22, weight: .semibold)
}
```

- [ ] **Step 3: Create GlassCard.swift**

```swift
import SwiftUI

struct GlassCard<Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(tint.opacity(0.08))
                        }
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    }
            }
    }
}

// Convenience modifier for views that want glass styling
extension View {
    func glassCard(tint: Color? = nil) -> some View {
        self
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(tint.opacity(0.08))
                        }
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    }
            }
    }
}
```

- [ ] **Step 4: Build to verify compilation**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Theme
git commit -m "feat(ios): theme system — colors, typography, glass card"
```

---

## Task 3: SwiftData Models & Enums

**Files:**
- Create: `apps/ios/Brett/Models/Enums.swift`
- Create: `apps/ios/Brett/Models/Item.swift`
- Create: `apps/ios/Brett/Models/ItemList.swift`
- Create: `apps/ios/Brett/Models/CalendarEvent.swift`
- Create: `apps/ios/Brett/Models/Scout.swift`
- Create: `apps/ios/Brett/Models/ScoutFinding.swift`
- Create: `apps/ios/Brett/Models/BrettMessage.swift`
- Create: `apps/ios/Brett/Models/Attachment.swift`
- Create: `apps/ios/Brett/Models/UserProfile.swift`
- Modify: `apps/ios/Brett/BrettApp.swift` (add model container)

- [ ] **Step 1: Create Enums.swift**

```swift
import Foundation

enum ItemType: String, Codable, CaseIterable {
    case task
    case content
}

enum ItemStatus: String, Codable, CaseIterable {
    case active
    case snoozed
    case done
    case archived
}

enum Urgency: String, Codable, CaseIterable {
    case overdue
    case today
    case thisWeek = "this_week"
    case nextWeek = "next_week"
    case later
    case done
}

enum DueDatePrecision: String, Codable {
    case day
    case week
}

enum ReminderType: String, Codable {
    case morningOf = "morning_of"
    case oneHourBefore = "1_hour_before"
    case dayBefore = "day_before"
    case custom
}

enum RecurrenceType: String, Codable {
    case daily
    case weekly
    case monthly
    case custom
}

enum ContentType: String, Codable {
    case tweet, article, video, pdf, podcast, webPage = "web_page", newsletter
}

enum ContentStatus: String, Codable {
    case pending, extracted, failed
}

enum ScoutStatus: String, Codable {
    case active, paused, completed, expired
}

enum ScoutSensitivity: String, Codable {
    case low, medium, high
}

enum ScoutAnalysisTier: String, Codable {
    case standard, deep
}

enum FindingType: String, Codable {
    case insight, article, task
}

enum CalendarRsvpStatus: String, Codable {
    case accepted, declined, tentative, needsAction
}

enum SyncStatus: String, Codable {
    case synced, pending, failed
}

enum MutationAction: String, Codable {
    case create = "CREATE"
    case update = "UPDATE"
    case delete = "DELETE"
}
```

- [ ] **Step 2: Create Item.swift**

```swift
import Foundation
import SwiftData

@Model
final class Item {
    @Attribute(.unique) var id: String
    var type: String = "task"        // ItemType raw value
    var status: String = "active"    // ItemStatus raw value
    var title: String
    var itemDescription: String?     // `description` is reserved in Swift
    var notes: String?
    var source: String = "Brett"
    var sourceId: String?
    var sourceUrl: String?
    var dueDate: Date?
    var dueDatePrecision: String?
    var completedAt: Date?
    var snoozedUntil: Date?
    var brettObservation: String?
    var reminder: String?
    var recurrence: String?
    var recurrenceRule: String?
    var listId: String?
    var contentType: String?
    var contentStatus: String?
    var contentTitle: String?
    var contentBody: String?
    var contentDescription: String?
    var contentImageUrl: String?
    var contentFavicon: String?
    var contentDomain: String?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?
    var lastError: String?

    init(
        id: String = UUID().uuidString,
        type: ItemType = .task,
        status: ItemStatus = .active,
        title: String,
        userId: String,
        dueDate: Date? = nil,
        listId: String? = nil,
        notes: String? = nil
    ) {
        self.id = id
        self.type = type.rawValue
        self.status = status.rawValue
        self.title = title
        self.userId = userId
        self.dueDate = dueDate
        self.listId = listId
        self.notes = notes
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    // Computed helpers
    var itemType: ItemType { ItemType(rawValue: type) ?? .task }
    var itemStatus: ItemStatus { ItemStatus(rawValue: status) ?? .active }
    var isCompleted: Bool { itemStatus == .done }
}
```

- [ ] **Step 3: Create ItemList.swift**

```swift
import Foundation
import SwiftData

@Model
final class ItemList {
    @Attribute(.unique) var id: String
    var name: String
    var colorClass: String = "bg-gray-500"
    var sortOrder: Int = 0
    var archivedAt: Date?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?
    var lastError: String?

    init(id: String = UUID().uuidString, name: String, colorClass: String = "bg-gray-500", userId: String) {
        self.id = id
        self.name = name
        self.colorClass = colorClass
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

- [ ] **Step 4: Create CalendarEvent.swift**

```swift
import Foundation
import SwiftData

@Model
final class CalendarEvent {
    @Attribute(.unique) var id: String
    var googleEventId: String
    var calendarId: String?
    var title: String
    var eventDescription: String?
    var location: String?
    var startTime: Date
    var endTime: Date
    var isAllDay: Bool = false
    var status: String = "confirmed"
    var myResponseStatus: String = "needsAction"
    var meetingLink: String?
    var organizerJSON: String?    // JSON string
    var attendeesJSON: String?    // JSON string
    var brettObservation: String?
    var calendarColor: String?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        googleEventId: String = "",
        title: String,
        startTime: Date,
        endTime: Date,
        userId: String,
        location: String? = nil,
        meetingLink: String? = nil,
        isAllDay: Bool = false
    ) {
        self.id = id
        self.googleEventId = googleEventId
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.userId = userId
        self.location = location
        self.meetingLink = meetingLink
        self.isAllDay = isAllDay
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var durationMinutes: Int {
        Int(endTime.timeIntervalSince(startTime) / 60)
    }
}
```

- [ ] **Step 5: Create Scout.swift and ScoutFinding.swift**

Scout.swift:
```swift
import Foundation
import SwiftData

@Model
final class Scout {
    @Attribute(.unique) var id: String
    var name: String
    var goal: String
    var context: String?
    var sourcesJSON: String?   // JSON array of { name, url? }
    var sensitivity: String = "medium"
    var analysisTier: String = "standard"
    var cadenceIntervalHours: Double
    var budgetUsed: Int = 0
    var budgetTotal: Int
    var status: String = "active"
    var statusLine: String?
    var nextRunAt: Date?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        name: String,
        goal: String,
        cadenceIntervalHours: Double = 24,
        budgetTotal: Int = 100,
        userId: String
    ) {
        self.id = id
        self.name = name
        self.goal = goal
        self.cadenceIntervalHours = cadenceIntervalHours
        self.budgetTotal = budgetTotal
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var scoutStatus: ScoutStatus { ScoutStatus(rawValue: status) ?? .active }
}
```

ScoutFinding.swift:
```swift
import Foundation
import SwiftData

@Model
final class ScoutFinding {
    @Attribute(.unique) var id: String
    var scoutId: String
    var type: String   // FindingType raw value
    var title: String
    var findingDescription: String
    var sourceUrl: String?
    var sourceName: String
    var relevanceScore: Double
    var reasoning: String
    var feedbackUseful: Bool?
    var itemId: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        scoutId: String,
        type: FindingType = .insight,
        title: String,
        description: String,
        sourceName: String,
        relevanceScore: Double = 0.8,
        reasoning: String = ""
    ) {
        self.id = id
        self.scoutId = scoutId
        self.type = type.rawValue
        self.title = title
        self.findingDescription = description
        self.sourceName = sourceName
        self.relevanceScore = relevanceScore
        self.reasoning = reasoning
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

- [ ] **Step 6: Create BrettMessage.swift and Attachment.swift**

BrettMessage.swift:
```swift
import Foundation
import SwiftData

@Model
final class BrettMessage {
    @Attribute(.unique) var id: String
    var itemId: String?
    var calendarEventId: String?
    var role: String  // "user" or "brett"
    var content: String
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(id: String = UUID().uuidString, role: String, content: String, userId: String, itemId: String? = nil, calendarEventId: String? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.userId = userId
        self.itemId = itemId
        self.calendarEventId = calendarEventId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

Attachment.swift:
```swift
import Foundation
import SwiftData

@Model
final class Attachment {
    @Attribute(.unique) var id: String
    var filename: String
    var mimeType: String
    var sizeBytes: Int
    var storageKey: String
    var url: String?
    var itemId: String
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(id: String = UUID().uuidString, filename: String, mimeType: String, sizeBytes: Int, storageKey: String, itemId: String, userId: String) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.storageKey = storageKey
        self.itemId = itemId
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

- [ ] **Step 7: Create UserProfile.swift**

```swift
import Foundation
import SwiftData

@Model
final class UserProfile {
    @Attribute(.unique) var id: String
    var email: String
    var name: String
    var avatarUrl: String?
    var assistantName: String = "Brett"
    var timezone: String = "America/Los_Angeles"
    var city: String?
    var countryCode: String?
    var tempUnit: String = "auto"
    var weatherEnabled: Bool = true
    var backgroundStyle: String = "photography"
    var updatedAt: Date

    init(id: String, email: String, name: String) {
        self.id = id
        self.email = email
        self.name = name
        self.updatedAt = Date()
    }
}
```

- [ ] **Step 8: Update BrettApp.swift with model container**

```swift
import SwiftUI
import SwiftData

@main
struct BrettApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [
            Item.self,
            ItemList.self,
            CalendarEvent.self,
            Scout.self,
            ScoutFinding.self,
            BrettMessage.self,
            Attachment.self,
            UserProfile.self,
        ])
    }
}
```

- [ ] **Step 9: Build to verify all models compile**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 10: Commit**

```bash
git add apps/ios/Brett/Models
git commit -m "feat(ios): SwiftData models — Item, ItemList, CalendarEvent, Scout, BrettMessage, UserProfile"
```

---

## Task 4: Date Helpers & Utilities

**Files:**
- Create: `apps/ios/Brett/Utilities/DateHelpers.swift`
- Create: `apps/ios/Brett/Utilities/HapticManager.swift`
- Create: `apps/ios/BrettTests/DateHelpersTests.swift`

- [ ] **Step 1: Write failing tests for DateHelpers**

```swift
import Testing
import Foundation
@testable import Brett

@Suite("DateHelpers")
struct DateHelpersTests {
    @Test func computeUrgencyOverdue() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        #expect(DateHelpers.computeUrgency(dueDate: yesterday, isCompleted: false) == .overdue)
    }

    @Test func computeUrgencyToday() {
        let today = Calendar.current.startOfDay(for: Date())
        #expect(DateHelpers.computeUrgency(dueDate: today, isCompleted: false) == .today)
    }

    @Test func computeUrgencyThisWeek() {
        // Find a date that's this week but not today
        let calendar = Calendar.current
        let today = Date()
        let weekday = calendar.component(.weekday, from: today)
        let daysUntilEndOfWeek = 7 - weekday
        if daysUntilEndOfWeek > 0 {
            let laterThisWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: today)!
            #expect(DateHelpers.computeUrgency(dueDate: laterThisWeek, isCompleted: false) == .thisWeek)
        }
    }

    @Test func computeUrgencyDone() {
        let today = Date()
        #expect(DateHelpers.computeUrgency(dueDate: today, isCompleted: true) == .done)
    }

    @Test func computeUrgencyNoDueDate() {
        #expect(DateHelpers.computeUrgency(dueDate: nil, isCompleted: false) == .later)
    }

    @Test func formatRelativeDate() {
        let today = Calendar.current.startOfDay(for: Date())
        #expect(DateHelpers.formatRelativeDate(today).contains("Today") || DateHelpers.formatRelativeDate(today).lowercased().contains("today"))

        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: today)!
        #expect(DateHelpers.formatRelativeDate(tomorrow).contains("Tomorrow") || DateHelpers.formatRelativeDate(tomorrow).lowercased().contains("tomorrow"))
    }

    @Test func formatTime() {
        var components = DateComponents()
        components.hour = 14
        components.minute = 30
        let date = Calendar.current.date(from: components)!
        let formatted = DateHelpers.formatTime(date)
        #expect(formatted.contains("2:30") || formatted.contains("14:30"))
    }
}
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | grep -E "(Test|FAIL|PASS|error:)" | head -20
```

Expected: compilation errors — `DateHelpers` not defined yet.

- [ ] **Step 3: Implement DateHelpers.swift**

```swift
import Foundation

enum DateHelpers {
    static func computeUrgency(dueDate: Date?, isCompleted: Bool) -> Urgency {
        if isCompleted { return .done }
        guard let dueDate else { return .later }

        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startOfDueDay = calendar.startOfDay(for: dueDate)

        if startOfDueDay < startOfToday {
            return .overdue
        }

        if calendar.isDate(dueDate, inSameDayAs: now) {
            return .today
        }

        // End of this week (Sunday)
        let endOfWeek = calendar.date(byAdding: .day, value: 7 - calendar.component(.weekday, from: now), to: startOfToday)!
        if startOfDueDay <= endOfWeek {
            return .thisWeek
        }

        // End of next week
        let endOfNextWeek = calendar.date(byAdding: .day, value: 7, to: endOfWeek)!
        if startOfDueDay <= endOfNextWeek {
            return .nextWeek
        }

        return .later
    }

    static func formatRelativeDate(_ date: Date) -> String {
        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }

        let formatter = DateFormatter()
        // Within the same week
        let dayDiff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if dayDiff > 0 && dayDiff < 7 {
            formatter.dateFormat = "EEEE"  // "Wednesday"
            return formatter.string(from: date)
        }

        formatter.dateFormat = "MMM d"     // "Apr 11"
        return formatter.string(from: date)
    }

    static func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    static func formatDayHeader(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"  // "Wednesday, Apr 8"
        return formatter.string(from: date)
    }

    static func meetingDurationText(events: [CalendarEvent]) -> String {
        let totalMinutes = events.reduce(0) { $0 + $1.durationMinutes }
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 && minutes > 0 {
            return "\(hours)h \(minutes)m"
        } else if hours > 0 {
            return "\(hours)h"
        } else {
            return "\(minutes)m"
        }
    }
}
```

- [ ] **Step 4: Implement HapticManager.swift**

```swift
import UIKit

enum HapticManager {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func heavy() {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    }

    static func rigid() {
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | grep -E "(Test|FAIL|PASS)" | head -20
```

Expected: All DateHelpers tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Utilities apps/ios/BrettTests
git commit -m "feat(ios): date helpers, haptic manager, and tests"
```

---

## Task 5: Mock Data & Store

**Files:**
- Create: `apps/ios/Brett/Mock/MockData.swift`
- Create: `apps/ios/Brett/Mock/MockStore.swift`

- [ ] **Step 1: Create MockData.swift**

Static fixtures with realistic data. All dates relative to `Date()` so they always feel current.

```swift
import Foundation

enum MockData {
    static let userId = "mock-user-001"

    // MARK: - Lists

    static let lists: [MockList] = [
        MockList(id: "list-work", name: "Work", colorHex: "#3B82F6", sortOrder: 0),
        MockList(id: "list-personal", name: "Personal", colorHex: "#8B5CF6", sortOrder: 1),
        MockList(id: "list-health", name: "Health", colorHex: "#10B981", sortOrder: 2),
        MockList(id: "list-side", name: "Side Project", colorHex: "#F59E0B", sortOrder: 3),
    ]

    // MARK: - Items

    static var items: [MockItem] {
        let cal = Calendar.current
        let now = Date()
        let today = cal.startOfDay(for: now)
        let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
        let twoDaysAgo = cal.date(byAdding: .day, value: -2, to: today)!
        let tomorrow = cal.date(byAdding: .day, value: 1, to: today)!
        let dayAfter = cal.date(byAdding: .day, value: 2, to: today)!
        let thisWeekEnd = cal.date(byAdding: .day, value: 3, to: today)!
        let nextWeek = cal.date(byAdding: .day, value: 7, to: today)!
        let nextWeekPlus = cal.date(byAdding: .day, value: 10, to: today)!
        let nextWeekEnd = cal.date(byAdding: .day, value: 12, to: today)!

        return [
            // Overdue
            MockItem(id: "item-1", title: "Submit Q1 expense report", dueDate: twoDaysAgo, listId: "list-work", listName: "Work", time: "9:00 AM"),
            MockItem(id: "item-2", title: "Renew gym membership", dueDate: yesterday, listId: "list-health", listName: "Health", time: "9:00 AM"),

            // Today
            MockItem(id: "item-3", title: "Prep slides for Q2 review", dueDate: today, listId: "list-work", listName: "Work", time: "9:00 AM", notes: "Use last quarter's deck as a template. Focus on YoY growth metrics.", subtasks: [
                MockSubtask(id: "sub-1", title: "Pull metrics from analytics dashboard", isCompleted: true),
                MockSubtask(id: "sub-2", title: "Add pipeline slide with deal stages", isCompleted: false),
                MockSubtask(id: "sub-3", title: "Write exec summary (3 bullets max)", isCompleted: false),
            ]),
            MockItem(id: "item-4", title: "Push mobile auth fix to staging", dueDate: today, listId: "list-side", listName: "Side Project", time: "10:30 AM"),
            MockItem(id: "item-5", title: "Review Ali's PR — pagination refactor", dueDate: today, listId: "list-work", listName: "Work", time: "11:00 AM"),
            MockItem(id: "item-6", title: "Book physio appointment", dueDate: today, listId: "list-health", listName: "Health", time: "2:00 PM"),

            // Done today
            MockItem(id: "item-7", title: "Morning standup", dueDate: today, listId: "list-work", listName: "Work", isCompleted: true),
            MockItem(id: "item-8", title: "Reply to investor update email", dueDate: today, listId: "list-work", listName: "Work", isCompleted: true),
            MockItem(id: "item-9", title: "Order new monitor stand", dueDate: today, listId: "list-personal", listName: "Personal", isCompleted: true),

            // This week
            MockItem(id: "item-10", title: "Draft technical spec for sync v2", dueDate: dayAfter, listId: "list-work", listName: "Work"),
            MockItem(id: "item-11", title: "Research standing desk options", dueDate: thisWeekEnd, listId: "list-personal", listName: "Personal"),

            // Next week
            MockItem(id: "item-12", title: "Annual performance self-review", dueDate: nextWeek, listId: "list-work", listName: "Work"),
            MockItem(id: "item-13", title: "Plan birthday dinner for Sam", dueDate: nextWeekPlus, listId: "list-personal", listName: "Personal"),
            MockItem(id: "item-14", title: "Ship public beta of side project", dueDate: nextWeekEnd, listId: "list-side", listName: "Side Project"),
        ]
    }

    // MARK: - Inbox

    static var inboxItems: [MockItem] {
        [
            MockItem(id: "inbox-1", title: "The Morning Brew — AI edition", type: .content, contentDomain: "morningbrew.com"),
            MockItem(id: "inbox-2", title: "Hacker News Digest — top 10 this week", type: .content, contentDomain: "hackernewsdigest.com"),
            MockItem(id: "inbox-3", title: "Figure out 2026 vacation days", capturedAgo: "yesterday"),
            MockItem(id: "inbox-4", title: "Why React Compiler changes how you think about memoization", type: .content, contentDomain: "react.dev"),
            MockItem(id: "inbox-5", title: "Look into Expo OTA update strategy for prod", capturedAgo: "2d ago"),
            MockItem(id: "inbox-6", title: "Explore Tauri v2 for the desktop app", capturedAgo: "3d ago"),
        ]
    }

    // MARK: - Calendar Events

    static var events: [MockEvent] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())

        return [
            MockEvent(id: "evt-1", title: "Q2 Review", startHour: 10, startMinute: 0, durationMinutes: 60, location: "Conf Room B", color: "#3B82F6"),
            MockEvent(id: "evt-2", title: "Design Sync", startHour: 11, startMinute: 0, durationMinutes: 30, meetingLink: "Google Meet", color: "#10B981"),
            MockEvent(id: "evt-3", title: "1:1 with Manager", startHour: 14, startMinute: 0, durationMinutes: 45, meetingLink: "Zoom", color: "#8B5CF6"),
        ]
    }

    // MARK: - Briefing

    static let briefing = """
    Good morning. You have **3 meetings today** starting at 10am with the Q2 Review — your slides are still in progress.

    **2 overdue tasks** need attention before end of day: the Q1 expense report is 2 days late, and your gym membership lapsed yesterday.

    Your AI Competitor Watch scout flagged something worth reading: **Linear just shipped AI triage**, which lands squarely on your own roadmap. Worth a 5-minute read before the design sync.

    Focus recommendation: clear the **expense report first** (30 min), prep the **Q2 slides** (45 min), then you're in good shape for the 10am.
    """
}

// MARK: - Mock Types

struct MockList: Identifiable {
    let id: String
    let name: String
    let colorHex: String
    let sortOrder: Int
}

struct MockItem: Identifiable {
    let id: String
    let title: String
    var type: ItemType = .task
    var dueDate: Date? = nil
    var listId: String? = nil
    var listName: String? = nil
    var time: String? = nil
    var isCompleted: Bool = false
    var notes: String? = nil
    var subtasks: [MockSubtask] = []
    var contentDomain: String? = nil
    var capturedAgo: String? = nil
}

struct MockSubtask: Identifiable {
    let id: String
    let title: String
    var isCompleted: Bool
}

struct MockEvent: Identifiable {
    let id: String
    let title: String
    let startHour: Int
    let startMinute: Int
    let durationMinutes: Int
    var location: String? = nil
    var meetingLink: String? = nil
    let color: String

    var startDate: Date {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        return cal.date(bySettingHour: startHour, minute: startMinute, second: 0, of: today)!
    }

    var endDate: Date {
        Calendar.current.date(byAdding: .minute, value: durationMinutes, to: startDate)!
    }
}
```

- [ ] **Step 2: Create MockStore.swift**

```swift
import Foundation
import Observation

@Observable
final class MockStore {
    var items: [MockItem] = MockData.items
    var inboxItems: [MockItem] = MockData.inboxItems
    var lists: [MockList] = MockData.lists
    var events: [MockEvent] = MockData.events
    var briefing: String = MockData.briefing
    var briefingDismissed: Bool = false
    var briefingCollapsed: Bool = false

    // MARK: - Computed sections

    var overdueItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .overdue }
    }

    var todayItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .today }
    }

    var thisWeekItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .thisWeek }
    }

    var nextWeekItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .nextWeek }
    }

    var doneItems: [MockItem] {
        items.filter { $0.isCompleted }
    }

    var todayEvents: [MockEvent] {
        events.sorted { $0.startHour < $1.startHour || ($0.startHour == $1.startHour && $0.startMinute < $1.startMinute) }
    }

    var totalTasks: Int { items.count }
    var completedTasks: Int { items.filter(\.isCompleted).count }
    var meetingCount: Int { events.count }
    var meetingDuration: String {
        let total = events.reduce(0) { $0 + $1.durationMinutes }
        let hours = total / 60
        let mins = total % 60
        if hours > 0 && mins > 0 { return "\(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h" }
        return "\(mins)m"
    }

    // MARK: - Actions

    func toggleItem(_ id: String) {
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items[idx] = MockItem(
                id: items[idx].id,
                title: items[idx].title,
                type: items[idx].type,
                dueDate: items[idx].dueDate,
                listId: items[idx].listId,
                listName: items[idx].listName,
                time: items[idx].time,
                isCompleted: !items[idx].isCompleted,
                notes: items[idx].notes,
                subtasks: items[idx].subtasks
            )
        }
    }

    func addItem(title: String, dueDate: Date? = nil, listId: String? = nil) {
        let listName = lists.first(where: { $0.id == listId })?.name
        let newItem = MockItem(
            id: UUID().uuidString,
            title: title,
            dueDate: dueDate,
            listId: listId,
            listName: listName
        )
        items.insert(newItem, at: 0)
    }

    func itemsForList(_ listId: String) -> [MockItem] {
        items.filter { $0.listId == listId && !$0.isCompleted }
    }
}
```

- [ ] **Step 3: Build to verify**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Mock
git commit -m "feat(ios): mock data and observable store for UI prototyping"
```

---

## Task 6: Background View & Page Indicator

**Files:**
- Create: `apps/ios/Brett/Views/Shared/BackgroundView.swift`
- Create: `apps/ios/Brett/Views/Shared/PageIndicator.swift`

- [ ] **Step 1: Create BackgroundView.swift**

For the prototype, use a bundled image or a gradient. The living background system will be wired later — what matters now is the glass has something to refract.

```swift
import SwiftUI

struct BackgroundView: View {
    var body: some View {
        ZStack {
            // Base: dark atmospheric gradient (placeholder for living background)
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.07, blue: 0.12),
                    Color(red: 0.08, green: 0.12, blue: 0.20),
                    Color(red: 0.04, green: 0.06, blue: 0.10),
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            // Subtle texture / noise to avoid flat feel
            // In production, this will be a photograph
            // For now, add subtle color variation
            RadialGradient(
                colors: [
                    Color(red: 0.12, green: 0.18, blue: 0.30).opacity(0.4),
                    Color.clear,
                ],
                center: .topTrailing,
                startRadius: 100,
                endRadius: 500
            )

            // Top vignette for status bar readability
            VStack {
                LinearGradient(
                    colors: [Color.black.opacity(0.6), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 120)
                Spacer()
            }

            // Bottom vignette for omnibar readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.4)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 140)
            }
        }
        .ignoresSafeArea()
    }
}
```

- [ ] **Step 2: Create PageIndicator.swift**

```swift
import SwiftUI

struct PageIndicator: View {
    let pages: [String]
    let currentIndex: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(pages.enumerated()), id: \.offset) { index, name in
                Circle()
                    .fill(index == currentIndex ? BrettColors.gold : Color.white.opacity(0.25))
                    .frame(width: index == currentIndex ? 7 : 5, height: index == currentIndex ? 7 : 5)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: currentIndex)
            }
        }
    }
}
```

- [ ] **Step 3: Build to verify**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Views/Shared
git commit -m "feat(ios): background view with vignettes and page indicator"
```

---

## Task 7: Shared Components (TaskRow, GoldCheckbox, EmptyState)

**Files:**
- Create: `apps/ios/Brett/Views/Shared/TaskRow.swift`
- Create: `apps/ios/Brett/Views/Shared/GoldCheckbox.swift`
- Create: `apps/ios/Brett/Views/Shared/EmptyState.swift`

- [ ] **Step 1: Create GoldCheckbox.swift**

```swift
import SwiftUI

struct GoldCheckbox: View {
    let isChecked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: {
            HapticManager.light()
            action()
        }) {
            ZStack {
                Circle()
                    .strokeBorder(isChecked ? BrettColors.gold : Color.white.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 22, height: 22)

                if isChecked {
                    Circle()
                        .fill(BrettColors.gold)
                        .frame(width: 22, height: 22)

                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 44, height: 44) // 44pt tap target
        .contentShape(Rectangle())
        .accessibilityLabel(isChecked ? "Completed" : "Not completed")
        .accessibilityHint("Double-tap to toggle")
    }
}
```

- [ ] **Step 2: Create TaskRow.swift**

```swift
import SwiftUI

struct TaskRow: View {
    let item: MockItem
    let onToggle: () -> Void
    var onTap: (() -> Void)? = nil

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 12) {
                GoldCheckbox(isChecked: item.isCompleted, action: onToggle)

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(item.isCompleted ? Color.white.opacity(0.35) : BrettColors.textPrimary)
                        .strikethrough(item.isCompleted, color: Color.white.opacity(0.2))
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        if let time = item.time {
                            Text(time)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textSecondary)
                        } else if let captured = item.capturedAgo {
                            Text("Captured \(captured)")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textSecondary)
                        }

                        if let listName = item.listName {
                            Text("·")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textTertiary)
                            Text(listName)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textSecondary)
                        }

                        if let domain = item.contentDomain {
                            Text(domain)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.6))
                        }
                    }
                }

                Spacer()
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(item.listName ?? ""), \(item.isCompleted ? "completed" : "pending")")
        .accessibilityHint("Double-tap for details")
    }
}
```

- [ ] **Step 3: Create EmptyState.swift**

```swift
import SwiftUI

struct EmptyState: View {
    let heading: String?
    let copy: String

    var body: some View {
        VStack(spacing: 12) {
            if let heading {
                Text(heading)
                    .font(BrettTypography.emptyHeading)
                    .foregroundStyle(.white)
            }
            Text(copy)
                .font(BrettTypography.emptyCopy)
                .foregroundStyle(Color.white.opacity(0.50))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

- [ ] **Step 4: Build to verify**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Views/Shared
git commit -m "feat(ios): shared components — TaskRow, GoldCheckbox, EmptyState"
```

---

## Task 8: Today Page

**Files:**
- Create: `apps/ios/Brett/Views/Today/DayHeader.swift`
- Create: `apps/ios/Brett/Views/Today/DailyBriefing.swift`
- Create: `apps/ios/Brett/Views/Today/TaskSection.swift`
- Create: `apps/ios/Brett/Views/Today/TodayPage.swift`

- [ ] **Step 1: Create DayHeader.swift**

```swift
import SwiftUI

struct DayHeader: View {
    let completedCount: Int
    let totalCount: Int
    let meetingCount: Int
    let meetingDuration: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(DateHelpers.formatDayHeader(Date()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text("\(completedCount) of \(totalCount) done · \(meetingCount) meeting\(meetingCount == 1 ? "" : "s") (\(meetingDuration))")
                .font(BrettTypography.stats)
                .foregroundStyle(Color.white.opacity(0.35))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }
}
```

- [ ] **Step 2: Create DailyBriefing.swift**

```swift
import SwiftUI

struct DailyBriefing: View {
    let text: String
    @Binding var isCollapsed: Bool
    @Binding var isDismissed: Bool

    @ViewBuilder
    var body: some View {
        if !isDismissed {
            GlassCard(tint: BrettColors.cerulean) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("DAILY BRIEFING")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(1.5)
                            .foregroundStyle(BrettColors.ceruleanLabel)

                        Spacer()

                        Button {
                            withAnimation(.easeOut(duration: 0.25)) {
                                isCollapsed.toggle()
                            }
                        } label: {
                            Image(systemName: isCollapsed ? "chevron.down" : "chevron.up")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.3))
                        }
                        .buttonStyle(.plain)
                    }

                    if !isCollapsed {
                        Text(text)
                            .font(BrettTypography.body)
                            .foregroundStyle(Color.white.opacity(0.60))
                            .lineSpacing(4)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
```

- [ ] **Step 3: Create TaskSection.swift**

```swift
import SwiftUI

struct TaskSection: View {
    let label: String
    let items: [MockItem]
    let labelColor: Color
    var accentColor: Color? = nil
    let onToggle: (String) -> Void
    let onTap: (String) -> Void

    @ViewBuilder
    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(labelColor)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)

                GlassCard {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if let accent = accentColor {
                                HStack(spacing: 0) {
                                    Rectangle()
                                        .fill(accent)
                                        .frame(width: 3)
                                        .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                        .padding(.vertical, 4)

                                    TaskRow(
                                        item: item,
                                        onToggle: { onToggle(item.id) },
                                        onTap: { onTap(item.id) }
                                    )
                                    .padding(.leading, 8)
                                }
                            } else {
                                TaskRow(
                                    item: item,
                                    onToggle: { onToggle(item.id) },
                                    onTap: { onTap(item.id) }
                                )
                            }

                            if index < items.count - 1 {
                                Divider()
                                    .background(BrettColors.hairline)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}
```

- [ ] **Step 4: Create TodayPage.swift**

```swift
import SwiftUI

struct TodayPage: View {
    @Bindable var store: MockStore
    @State private var selectedItemId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                DayHeader(
                    completedCount: store.completedTasks,
                    totalCount: store.totalTasks,
                    meetingCount: store.meetingCount,
                    meetingDuration: store.meetingDuration
                )
                .padding(.top, 60) // Below status bar + page indicator

                // Briefing
                DailyBriefing(
                    text: store.briefing,
                    isCollapsed: $store.briefingCollapsed,
                    isDismissed: $store.briefingDismissed
                )

                // Overdue
                TaskSection(
                    label: "Overdue",
                    items: store.overdueItems,
                    labelColor: BrettColors.error,
                    accentColor: BrettColors.error,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Today
                TaskSection(
                    label: "Today",
                    items: store.todayItems,
                    labelColor: BrettColors.goldLabel,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // This Week
                TaskSection(
                    label: "This Week",
                    items: store.thisWeekItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Next Week
                TaskSection(
                    label: "Next Week",
                    items: store.nextWeekItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Done Today
                TaskSection(
                    label: "Done Today",
                    items: store.doneItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                Spacer(minLength: 100) // Space for omnibar
            }
        }
        .scrollIndicators(.hidden)
        .navigationDestination(for: String.self) { itemId in
            TaskDetailView(store: store, itemId: itemId)
        }
    }
}
```

- [ ] **Step 5: Build to verify**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -3
```

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Views/Today
git commit -m "feat(ios): Today page — header, briefing, task sections on glass"
```

---

## Task 9: Inbox Page

**Files:**
- Create: `apps/ios/Brett/Views/Inbox/InboxPage.swift`

- [ ] **Step 1: Create InboxPage.swift**

```swift
import SwiftUI

struct InboxPage: View {
    @Bindable var store: MockStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text("Inbox")
                        .font(BrettTypography.dateHeader)
                        .foregroundStyle(.white)

                    Text("\(store.inboxItems.count) items to triage")
                        .font(BrettTypography.stats)
                        .foregroundStyle(Color.white.opacity(0.35))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 60)

                if store.inboxItems.isEmpty {
                    EmptyState(heading: "Your inbox", copy: "Everything worth doing starts here.")
                } else {
                    // One glass card for all inbox items
                    GlassCard {
                        VStack(spacing: 0) {
                            ForEach(Array(store.inboxItems.enumerated()), id: \.element.id) { index, item in
                                HStack(spacing: 0) {
                                    // Cerulean accent for content items
                                    if item.type == .content {
                                        Rectangle()
                                            .fill(BrettColors.cerulean)
                                            .frame(width: 3)
                                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                            .padding(.vertical, 4)
                                    }

                                    TaskRow(
                                        item: item,
                                        onToggle: { },
                                        onTap: { }
                                    )
                                    .padding(.leading, item.type == .content ? 8 : 0)
                                }

                                if index < store.inboxItems.count - 1 {
                                    Divider()
                                        .background(BrettColors.hairline)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                Spacer(minLength: 100)
            }
        }
        .scrollIndicators(.hidden)
    }
}
```

- [ ] **Step 2: Build to verify**

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Views/Inbox
git commit -m "feat(ios): Inbox page with content type accents"
```

---

## Task 10: Calendar Page

**Files:**
- Create: `apps/ios/Brett/Views/Calendar/WeekStrip.swift`
- Create: `apps/ios/Brett/Views/Calendar/DayTimeline.swift`
- Create: `apps/ios/Brett/Views/Calendar/CalendarPage.swift`

- [ ] **Step 1: Create WeekStrip.swift**

```swift
import SwiftUI

struct WeekStrip: View {
    @Binding var selectedDate: Date
    let events: [MockEvent]

    private let calendar = Calendar.current
    private let dayLabels = ["M", "T", "W", "T", "F", "S", "S"]

    private var weekDays: [Date] {
        let today = calendar.startOfDay(for: Date())
        let weekday = calendar.component(.weekday, from: today)
        // Start on Monday (weekday 2 in Gregorian)
        let monday = calendar.date(byAdding: .day, value: -(weekday == 1 ? 6 : weekday - 2), to: today)!
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
    }

    var body: some View {
        GlassCard {
            HStack(spacing: 0) {
                ForEach(Array(weekDays.enumerated()), id: \.offset) { index, day in
                    let isToday = calendar.isDateInToday(day)
                    let isSelected = calendar.isDate(day, inSameDayAs: selectedDate)

                    Button {
                        selectedDate = day
                    } label: {
                        VStack(spacing: 6) {
                            Text(dayLabels[index])
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.4))

                            ZStack {
                                if isToday {
                                    Circle()
                                        .fill(BrettColors.gold)
                                        .frame(width: 32, height: 32)
                                } else if isSelected {
                                    Circle()
                                        .fill(Color.white.opacity(0.15))
                                        .frame(width: 32, height: 32)
                                }

                                Text("\(calendar.component(.day, from: day))")
                                    .font(.system(size: 15, weight: isToday ? .bold : .regular))
                                    .foregroundStyle(isToday ? .black : .white)
                            }

                            // Event dot
                            Circle()
                                .fill(hasEvents(on: day) ? BrettColors.gold.opacity(0.6) : Color.clear)
                                .frame(width: 4, height: 4)
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func hasEvents(on date: Date) -> Bool {
        // For mock data, all events are "today"
        calendar.isDateInToday(date) && !events.isEmpty
    }
}
```

- [ ] **Step 2: Create DayTimeline.swift**

```swift
import SwiftUI

struct DayTimeline: View {
    let events: [MockEvent]
    let hourHeight: CGFloat = 60

    private let startHour = 7
    private let endHour = 20

    var body: some View {
        ScrollView {
            ZStack(alignment: .topLeading) {
                // Hour lines
                VStack(spacing: 0) {
                    ForEach(startHour...endHour, id: \.self) { hour in
                        HStack(alignment: .top, spacing: 8) {
                            Text(formatHour(hour))
                                .font(.system(size: 11, weight: .regular))
                                .foregroundStyle(Color.white.opacity(0.25))
                                .frame(width: 45, alignment: .trailing)

                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(height: 0.5)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(height: hourHeight)
                    }
                }

                // Event blocks
                ForEach(events) { event in
                    let yOffset = CGFloat(event.startHour - startHour) * hourHeight +
                                  CGFloat(event.startMinute) / 60.0 * hourHeight
                    let height = CGFloat(event.durationMinutes) / 60.0 * hourHeight

                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(Color(hex: event.color) ?? BrettColors.gold)
                            .frame(width: 3)
                            .clipShape(RoundedRectangle(cornerRadius: 1.5))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BrettColors.textPrimary)

                            if let location = event.location {
                                Text("\(location) · \(event.durationMinutes)min")
                                    .font(.system(size: 11))
                                    .foregroundStyle(BrettColors.textSecondary)
                            } else if let link = event.meetingLink {
                                Text("\(link) · \(event.durationMinutes)min")
                                    .font(.system(size: 11))
                                    .foregroundStyle(BrettColors.textSecondary)
                            }
                        }
                        .padding(.leading, 8)
                        .padding(.vertical, 6)

                        Spacer()
                    }
                    .frame(height: max(height - 4, 28))
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                            }
                    }
                    .padding(.leading, 58)
                    .padding(.trailing, 16)
                    .offset(y: yOffset)
                }

                // Current time indicator
                currentTimeIndicator
            }
            .padding(.bottom, 100)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var currentTimeIndicator: some View {
        let now = Date()
        let cal = Calendar.current
        let hour = cal.component(.hour, from: now)
        let minute = cal.component(.minute, from: now)

        if hour >= startHour && hour <= endHour {
            let y = CGFloat(hour - startHour) * hourHeight + CGFloat(minute) / 60.0 * hourHeight

            HStack(spacing: 0) {
                Circle()
                    .fill(BrettColors.gold)
                    .frame(width: 8, height: 8)
                    .padding(.leading, 50)

                Rectangle()
                    .fill(BrettColors.gold)
                    .frame(height: 1)
            }
            .offset(y: y - 4)
        }
    }

    private func formatHour(_ hour: Int) -> String {
        if hour == 0 { return "12 AM" }
        if hour < 12 { return "\(hour) AM" }
        if hour == 12 { return "12 PM" }
        return "\(hour - 12) PM"
    }
}

// Color hex extension
extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return nil
        }
        self.init(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
```

- [ ] **Step 3: Create CalendarPage.swift**

```swift
import SwiftUI

struct CalendarPage: View {
    @Bindable var store: MockStore
    @State private var selectedDate = Date()

    var body: some View {
        VStack(spacing: 16) {
            // Month header
            Text(selectedDate.formatted(.dateTime.month(.wide).year()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 60)

            // Week strip
            WeekStrip(selectedDate: $selectedDate, events: store.events)

            // Day timeline
            DayTimeline(events: store.todayEvents)
        }
    }
}
```

- [ ] **Step 4: Build to verify**

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Views/Calendar
git commit -m "feat(ios): Calendar page — week strip, day timeline, current time indicator"
```

---

## Task 11: Omnibar

**Files:**
- Create: `apps/ios/Brett/Views/Omnibar/OmnibarView.swift`
- Create: `apps/ios/Brett/Views/Omnibar/ListDrawer.swift`

- [ ] **Step 1: Create OmnibarView.swift**

```swift
import SwiftUI

struct OmnibarView: View {
    @Bindable var store: MockStore
    let placeholder: String
    @State private var text = ""
    @State private var isEditing = false
    @State private var showListDrawer = false
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Omnibar pill
            HStack(spacing: 12) {
                // List drawer button
                Button {
                    showListDrawer = true
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.4))
                }
                .buttonStyle(.plain)
                .frame(width: 28, height: 28)

                // Text field
                TextField(placeholder, text: $text)
                    .font(BrettTypography.omnibarPlaceholder)
                    .foregroundStyle(BrettColors.textPrimary)
                    .tint(BrettColors.gold)
                    .focused($isFocused)
                    .submitLabel(.done)
                    .onSubmit {
                        submitTask()
                    }

                // Mic button
                Button {
                    HapticManager.heavy()
                    // Voice mode — placeholder for now
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(BrettColors.gold.opacity(0.8))
                }
                .buttonStyle(.plain)
                .frame(width: 28, height: 28)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background {
                Capsule()
                    .fill(.regularMaterial)
                    .overlay {
                        Capsule()
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    }
                    .overlay(alignment: .leading) {
                        // Subtle gold accent on left edge
                        Capsule()
                            .fill(BrettColors.gold.opacity(0.3))
                            .frame(width: 3)
                            .padding(.leading, 1)
                            .padding(.vertical, 6)
                    }
            }
            .padding(.horizontal, 16)
        }
        .sheet(isPresented: $showListDrawer) {
            ListDrawer(store: store)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
    }

    private func submitTask() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        HapticManager.light()
        store.addItem(title: trimmed, dueDate: Date())
        text = ""
        isFocused = false
    }
}
```

- [ ] **Step 2: Create ListDrawer.swift**

```swift
import SwiftUI

struct ListDrawer: View {
    @Bindable var store: MockStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("LISTS")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.5)
                        .foregroundStyle(BrettColors.textTertiary)
                        .padding(.horizontal, 20)

                    // List pills
                    FlowLayout(spacing: 10) {
                        ForEach(store.lists) { list in
                            Button {
                                dismiss()
                                // Navigate to list detail — will be wired via navigation
                            } label: {
                                HStack(spacing: 8) {
                                    Circle()
                                        .fill(Color(hex: list.colorHex) ?? BrettColors.gold)
                                        .frame(width: 8, height: 8)

                                    Text(list.name)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(BrettColors.textPrimary)

                                    Text("\(store.itemsForList(list.id).count)")
                                        .font(.system(size: 12))
                                        .foregroundStyle(BrettColors.textSecondary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background {
                                    Capsule()
                                        .fill(Color.white.opacity(0.08))
                                        .overlay {
                                            Capsule()
                                                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                                        }
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Add list button
                        Button {
                            // Create list — placeholder
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus")
                                    .font(.system(size: 12, weight: .medium))
                                Text("New List")
                                    .font(.system(size: 14, weight: .medium))
                            }
                            .foregroundStyle(BrettColors.gold)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background {
                                Capsule()
                                    .strokeBorder(BrettColors.gold.opacity(0.3), lineWidth: 1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.top, 20)
            }
        }
    }
}

// Simple flow layout for list pills
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
```

- [ ] **Step 3: Build to verify**

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Views/Omnibar
git commit -m "feat(ios): Omnibar — glass pill, text input, mic, list drawer"
```

---

## Task 12: Main Container (3-Page Navigation)

**Files:**
- Create: `apps/ios/Brett/Views/MainContainer.swift`
- Modify: `apps/ios/Brett/BrettApp.swift`

- [ ] **Step 1: Create MainContainer.swift**

```swift
import SwiftUI

struct MainContainer: View {
    @State private var store = MockStore()
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar

    private let pages = ["Inbox", "Today", "Calendar"]

    var body: some View {
        NavigationStack {
            ZStack {
                // Living background
                BackgroundView()

                // Content pages
                VStack(spacing: 0) {
                    // Page indicator + settings
                    HStack {
                        Spacer()

                        PageIndicator(pages: pages, currentIndex: currentPage)

                        Spacer()
                    }
                    .overlay(alignment: .trailing) {
                        NavigationLink {
                            SettingsView()
                        } label: {
                            Image(systemName: "gearshape")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.4))
                                .frame(width: 44, height: 44)
                        }
                        .padding(.trailing, 12)
                    }
                    .padding(.top, 4)

                    // Horizontal paging
                    TabView(selection: $currentPage) {
                        InboxPage(store: store)
                            .tag(0)

                        TodayPage(store: store)
                            .tag(1)

                        CalendarPage(store: store)
                            .tag(2)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }

                // Omnibar overlay
                VStack {
                    Spacer()
                    OmnibarView(
                        store: store,
                        placeholder: currentPage == 0 ? "Capture something..." :
                                    currentPage == 2 ? "Add an event..." : "Add a task..."
                    )
                    .padding(.bottom, 8)
                }
            }
            .ignoresSafeArea(edges: .top)
        }
    }
}
```

- [ ] **Step 2: Update BrettApp.swift**

```swift
import SwiftUI
import SwiftData

@main
struct BrettApp: App {
    var body: some Scene {
        WindowGroup {
            MainContainer()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [
            Item.self,
            ItemList.self,
            CalendarEvent.self,
            Scout.self,
            ScoutFinding.self,
            BrettMessage.self,
            Attachment.self,
            UserProfile.self,
        ])
    }
}
```

- [ ] **Step 3: Build and run on simulator**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5
```

- [ ] **Step 4: Install, launch, screenshot**

```bash
xcrun simctl install "iPhone 17 Pro" $(find ~/Library/Developer/Xcode/DerivedData -name "Brett.app" -path "*/Debug-iphonesimulator/*" | head -1)
xcrun simctl launch "iPhone 17 Pro" com.brett.app
sleep 3
xcrun simctl io "iPhone 17 Pro" screenshot /tmp/brett-native-main.png
```

Expected: Today page visible with header, briefing card, task sections on glass, omnibar at bottom, atmospheric background.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Views/MainContainer.swift apps/ios/Brett/BrettApp.swift
git commit -m "feat(ios): main container — 3-page navigation, omnibar overlay, background"
```

---

## Task 13: Task Detail View

**Files:**
- Create: `apps/ios/Brett/Views/Detail/TaskDetailView.swift`

- [ ] **Step 1: Create TaskDetailView.swift**

```swift
import SwiftUI

struct TaskDetailView: View {
    @Bindable var store: MockStore
    let itemId: String
    @Environment(\.dismiss) private var dismiss

    private var item: MockItem? {
        store.items.first(where: { $0.id == itemId }) ??
        store.inboxItems.first(where: { $0.id == itemId })
    }

    var body: some View {
        ZStack {
            BackgroundView()

            if let item {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Title + checkbox
                        HStack(spacing: 14) {
                            GoldCheckbox(isChecked: item.isCompleted) {
                                store.toggleItem(item.id)
                            }

                            Text(item.title)
                                .font(BrettTypography.detailTitle)
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 20)

                        // Details card
                        GlassCard {
                            VStack(spacing: 0) {
                                detailRow(label: "Due", value: item.dueDate.map { DateHelpers.formatRelativeDate($0) } ?? "None")

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "List", value: item.listName ?? "None", valueColor: BrettColors.gold)

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "Reminder", value: "None")

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "Recurrence", value: "None")
                            }
                        }
                        .padding(.horizontal, 16)

                        // Notes card
                        if let notes = item.notes, !notes.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("NOTES")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(1.5)
                                    .foregroundStyle(BrettColors.textTertiary)
                                    .padding(.horizontal, 20)

                                GlassCard {
                                    Text(notes)
                                        .font(BrettTypography.body)
                                        .foregroundStyle(Color.white.opacity(0.70))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal, 16)
                            }
                        }

                        // Subtasks card
                        if !item.subtasks.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("SUBTASKS")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(1.5)
                                    .foregroundStyle(BrettColors.textTertiary)
                                    .padding(.horizontal, 20)

                                GlassCard {
                                    VStack(spacing: 0) {
                                        ForEach(Array(item.subtasks.enumerated()), id: \.element.id) { index, subtask in
                                            HStack(spacing: 12) {
                                                GoldCheckbox(isChecked: subtask.isCompleted) { }

                                                Text(subtask.title)
                                                    .font(BrettTypography.taskTitle)
                                                    .foregroundStyle(subtask.isCompleted ? Color.white.opacity(0.35) : BrettColors.textPrimary)
                                                    .strikethrough(subtask.isCompleted, color: Color.white.opacity(0.2))

                                                Spacer()
                                            }
                                            .padding(.vertical, 4)

                                            if index < item.subtasks.count - 1 {
                                                Divider().background(BrettColors.hairline)
                                            }
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                        }

                        // Brett chat prompt
                        GlassCard(tint: BrettColors.cerulean) {
                            HStack {
                                Image(systemName: "sparkle")
                                    .foregroundStyle(BrettColors.cerulean)
                                Text("Ask Brett about this task...")
                                    .font(BrettTypography.body)
                                    .foregroundStyle(BrettColors.cerulean.opacity(0.7))
                                Spacer()
                            }
                        }
                        .padding(.horizontal, 16)

                        Spacer(minLength: 40)
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Today")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
    }

    private func detailRow(label: String, value: String, valueColor: Color = BrettColors.textPrimary) -> some View {
        HStack {
            Text(label)
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textSecondary)
            Spacer()
            Text(value)
                .font(BrettTypography.body)
                .foregroundStyle(valueColor)
        }
        .padding(.vertical, 10)
    }
}
```

- [ ] **Step 2: Build to verify**

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Views/Detail
git commit -m "feat(ios): Task detail view — glass cards, notes, subtasks, Brett chat prompt"
```

---

## Task 14: Settings & Sign In (Stub)

**Files:**
- Create: `apps/ios/Brett/Views/Settings/SettingsView.swift`
- Create: `apps/ios/Brett/Views/Auth/SignInView.swift`

- [ ] **Step 1: Create SettingsView.swift**

```swift
import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BackgroundView()

            List {
                Section("Account") {
                    settingsRow(icon: "person.circle", title: "Profile")
                    settingsRow(icon: "lock.shield", title: "Security")
                }
                Section("Integrations") {
                    settingsRow(icon: "calendar", title: "Calendar")
                    settingsRow(icon: "cpu", title: "AI Providers")
                    settingsRow(icon: "newspaper", title: "Newsletters")
                }
                Section("Preferences") {
                    settingsRow(icon: "globe", title: "Timezone & Location")
                    settingsRow(icon: "list.bullet", title: "Lists")
                    settingsRow(icon: "square.and.arrow.down", title: "Import")
                }
                Section("App") {
                    settingsRow(icon: "arrow.triangle.2.circlepath", title: "Updates")
                    settingsRow(icon: "person.badge.minus", title: "Account", isDestructive: true)
                }
            }
            .scrollContentBackground(.hidden)
            .listStyle(.insetGrouped)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
    }

    private func settingsRow(icon: String, title: String, isDestructive: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.gold)
                .frame(width: 24)

            Text(title)
                .font(BrettTypography.taskTitle)
                .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.textPrimary)
        }
    }
}
```

- [ ] **Step 2: Create SignInView.swift (stub for later)**

```swift
import SwiftUI

struct SignInView: View {
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            BackgroundView()

            VStack(spacing: 24) {
                Spacer()

                // Logo
                Text("Brett")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(BrettColors.gold)

                Spacer()

                // Email
                TextField("Email", text: $email)
                    .textFieldStyle(.plain)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(.white)
                    .padding(14)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                            }
                    }
                    .textContentType(.emailAddress)
                    .autocapitalization(.none)

                // Password
                SecureField("Password", text: $password)
                    .textFieldStyle(.plain)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(.white)
                    .padding(14)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                            }
                    }
                    .textContentType(.password)

                // Sign In button
                Button {
                    // Auth — wired later
                } label: {
                    Text("Sign In")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                Text("or")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textSecondary)

                // Sign in with Google
                Button {
                } label: {
                    Text("Sign in with Google")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(.ultraThinMaterial)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                                }
                        }
                }

                // Sign in with Apple
                Button {
                } label: {
                    Text("Sign in with Apple")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                Spacer()
            }
            .padding(.horizontal, 32)
        }
    }
}
```

- [ ] **Step 3: Build to verify**

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Views/Settings apps/ios/Brett/Views/Auth
git commit -m "feat(ios): Settings and Sign In views (stubs)"
```

---

## Task 15: Integration, Polish & Verify

**Files:**
- Possibly modify: Multiple files for compilation fixes
- Create: `apps/ios/.gitignore`

- [ ] **Step 1: Create .gitignore for Xcode**

```
# Xcode
build/
DerivedData/
*.xcuserdata
*.xcworkspace/xcuserdata/
*.pbxuser
*.mode1v3
*.mode2v3
*.perspectivev3
xcuserdata/

# SPM
.build/
Packages/

# OS
.DS_Store
```

- [ ] **Step 2: Full build**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -10
```

Fix any compilation errors.

- [ ] **Step 3: Install, launch, screenshot all pages**

```bash
# Install and launch
xcrun simctl install "iPhone 17 Pro" $(find ~/Library/Developer/Xcode/DerivedData -name "Brett.app" -path "*/Debug-iphonesimulator/*" | head -1)
xcrun simctl launch "iPhone 17 Pro" com.brett.app
sleep 3

# Screenshot Today (center page)
xcrun simctl io "iPhone 17 Pro" screenshot /tmp/brett-native-today.png

# Navigate to other pages by clicking — verify all 3 pages render
# Take screenshots of Inbox and Calendar too
```

- [ ] **Step 4: Fix any visual issues**

Review each screenshot against the spec. Fix spacing, colors, typography, glass treatment issues.

- [ ] **Step 5: Commit**

```bash
git add apps/ios
git commit -m "feat(ios): integration pass — full build, all screens rendering"
```

---

## Summary

| Task | What | Key files |
|------|------|-----------|
| 1 | Xcode project setup | BrettApp.swift |
| 2 | Theme (colors, type, glass) | Theme/*.swift |
| 3 | SwiftData models + enums | Models/*.swift |
| 4 | Date helpers + haptics + tests | Utilities/*.swift |
| 5 | Mock data + observable store | Mock/*.swift |
| 6 | Background + page indicator | Shared/BackgroundView.swift |
| 7 | TaskRow, GoldCheckbox, EmptyState | Shared/*.swift |
| 8 | Today page | Today/*.swift |
| 9 | Inbox page | Inbox/InboxPage.swift |
| 10 | Calendar page | Calendar/*.swift |
| 11 | Omnibar + list drawer | Omnibar/*.swift |
| 12 | Main container (3-page nav) | MainContainer.swift |
| 13 | Task detail | Detail/TaskDetailView.swift |
| 14 | Settings + sign-in stubs | Settings/, Auth/ |
| 15 | Integration, polish, verify | All |

**Total: 15 tasks.** Each task is independently buildable and committable. After Task 12, the full app is visible on simulator for iteration.
