import XCTest

/// One-off audit harness — drives the calm-hero screens and writes a
/// screenshot of each to `/tmp/audit-*.png` for design-review pulls.
///
/// Each test relaunches the app pointed at a specific surface via
/// `-UITEST_START_PAGE=N` so we can capture the surface in its
/// natural state without trying to drive cross-page navigation
/// (which is flaky under XCUITest with the bottom adaptive chrome).
final class AuditScreenshots: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    func test01TodayTop() throws {
        let app = launch(page: 2)
        XCTAssertTrue(app.todayPage.waitForExistence(timeout: 10))
        attach(app, name: "01-today-top")
    }

    func test02TodayScrolled() throws {
        let app = launch(page: 2)
        XCTAssertTrue(app.todayPage.waitForExistence(timeout: 10))
        // Scroll twice to reveal the wash bed + adaptive chrome.
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        attach(app, name: "02-today-scrolled")
    }

    func test03Inbox() throws {
        let app = launch(page: 1)
        sleep(2)
        attach(app, name: "03-inbox")
    }

    func test04Lists() throws {
        let app = launch(page: 0)
        sleep(2)
        attach(app, name: "04-lists")
    }

    func test05Calendar() throws {
        let app = launch(page: 3)
        sleep(2)
        attach(app, name: "05-calendar")
    }

    func test06BMenu() throws {
        // Land on Inbox so the B chip is at full opacity (non-Today
        // pages always render the bar at 1.0).
        let app = launch(page: 1)
        sleep(1)
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        sleep(1)
        attach(app, name: "06-b-menu")
    }

    func test07Scouts() throws {
        let app = launch(page: 1)
        sleep(1)
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        sleep(1)
        let scouts = app.buttons["menu.scouts"]
        XCTAssertTrue(scouts.waitForExistence(timeout: 3))
        scouts.tap()
        sleep(2)
        attach(app, name: "07-scouts")
    }

    func test08Settings() throws {
        let app = launch(page: 1)
        sleep(1)
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        sleep(1)
        let settings = app.buttons["menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 3))
        settings.tap()
        sleep(2)
        attach(app, name: "08-settings")
    }

    func test09TaskDetail() throws {
        let app = launch(page: 2)
        sleep(2)
        let row = app.taskRow(withTitle: "Review design spec")
        if row.waitForExistence(timeout: 5) {
            row.tap()
            sleep(2)
            attach(app, name: "09-task-detail")
        }
    }

    // MARK: - Helpers

    private func launch(page: Int) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-UITEST_FAKE_AUTH",
            "-UITEST_IN_MEMORY_DATA",
            "-UITEST_MOCK_API",
            "-UITEST_RESET_STATE",
            "-UITEST_START_PAGE=\(page)",
        ]
        app.launch()
        return app
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let url = URL(fileURLWithPath: "/tmp/audit-\(name).png")
        try? screenshot.pngRepresentation.write(to: url)
    }
}
