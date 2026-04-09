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
