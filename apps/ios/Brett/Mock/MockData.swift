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

    // MARK: - Scouts

    static let scouts: [MockScout] = [
        MockScout(
            id: "scout-1",
            name: "Competitor Watch",
            goal: "Monitor competitor product launches, pricing changes, and feature announcements from Linear, Notion, Todoist, and Things 3. Flag anything that directly impacts our roadmap or positioning.",
            status: .active,
            sensitivity: "Notable only",
            cadence: "Every 8 hours",
            budgetUsed: 34,
            budgetTotal: 100,
            findingsCount: 7,
            lastRunAgo: "2h ago",
            findings: [
                MockFinding(id: "f-1", type: .article, title: "Linear shipped AI triage", description: "Linear released AI-powered inbox triage that auto-categorizes and prioritizes issues. Lands squarely on Brett's own roadmap.", source: "linear.app/blog", relevance: 0.92, ago: "2h ago"),
                MockFinding(id: "f-2", type: .insight, title: "Todoist sunset recurring task templates", description: "Todoist is deprecating shared recurring task templates in favor of their new Workflows feature. Could create migration opportunity.", source: "todoist.com/changelog", relevance: 0.78, ago: "6h ago"),
                MockFinding(id: "f-3", type: .task, title: "Review Notion's calendar integration approach", description: "Notion launched a native calendar view that syncs with Google Calendar bidirectionally — similar scope to our implementation.", source: "notion.so/blog", relevance: 0.85, ago: "1d ago"),
            ]
        ),
        MockScout(
            id: "scout-2",
            name: "AI Tooling Radar",
            goal: "Track new AI developer tools, APIs, and model releases relevant to building AI-powered productivity features. Focus on Anthropic, OpenAI, and open-source alternatives.",
            status: .active,
            sensitivity: "Everything",
            cadence: "Daily",
            budgetUsed: 12,
            budgetTotal: 50,
            findingsCount: 3,
            lastRunAgo: "8h ago",
            findings: [
                MockFinding(id: "f-4", type: .article, title: "Claude 4.5 prompt caching now GA", description: "Anthropic announced general availability of prompt caching, reducing costs by up to 90% for repeated context. Directly applicable to Brett's Take generation.", source: "anthropic.com/news", relevance: 0.95, ago: "8h ago"),
                MockFinding(id: "f-5", type: .insight, title: "Emerging pattern: tool-use for structured output", description: "Multiple AI apps are converging on using tool-use/function-calling as a more reliable way to get structured JSON output vs. raw prompting.", source: "Various", relevance: 0.72, ago: "1d ago"),
            ]
        ),
        MockScout(
            id: "scout-3",
            name: "Design Inspiration",
            goal: "Find iOS app design patterns, glassmorphism examples, and innovative mobile UX that could inspire Brett's mobile app. Focus on apps featured by Apple.",
            status: .paused,
            sensitivity: "Notable only",
            cadence: "Every 12 hours",
            budgetUsed: 45,
            budgetTotal: 50,
            findingsCount: 12,
            lastRunAgo: "3d ago",
            findings: []
        ),
    ]
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

struct MockScout: Identifiable {
    let id: String
    let name: String
    let goal: String
    let status: ScoutStatus
    let sensitivity: String
    let cadence: String
    let budgetUsed: Int
    let budgetTotal: Int
    let findingsCount: Int
    let lastRunAgo: String
    var findings: [MockFinding] = []
}

struct MockFinding: Identifiable {
    let id: String
    let type: FindingType
    let title: String
    let description: String
    let source: String
    let relevance: Double
    let ago: String
    var feedbackUseful: Bool? = nil
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
