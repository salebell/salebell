import Foundation
import Testing
@testable import Salebell

struct EventLabelTests {
    /// The backend's push titles come from `LABEL` in alerts.ts. Read it straight from the repo
    /// so the feed and the push notification can never disagree.
    private static func backendLabels() throws -> [String: (emoji: String, text: String)] {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let source = try String(contentsOf: repo.appending(path: "supabase/functions/_shared/core/alerts.ts"), encoding: .utf8)
        let block = try #require(source.range(of: #"const LABEL[^{]*\{([^}]*)\}"#, options: .regularExpression))
        let regex = try NSRegularExpression(pattern: #"(\w+): \["([^"]+)", "([^"]+)"\]"#)
        let text = String(source[block])
        var labels: [String: (String, String)] = [:]
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            let parts = (1...3).map { String(text[Range(match.range(at: $0), in: text)!]) }
            labels[parts[0]] = (parts[1], parts[2])
        }
        return labels
    }

    @Test func labelsMatchBackendAlerts() throws {
        let labels = try Self.backendLabels()
        #expect(labels.count == EventKind.allCases.count)
        for kind in EventKind.allCases {
            let backend = try #require(labels[kind.rawValue], "alerts.ts has no label for \(kind.rawValue)")
            #expect(kind.emoji == backend.emoji, "emoji for \(kind.rawValue)")
            #expect(kind.label == backend.text, "label for \(kind.rawValue)")
        }
    }

    @Test func rawValuesMapToKinds() {
        #expect(EventKind(raw: "purchase") == .purchase)
        #expect(EventKind(raw: "billing_issue") == .billingIssue)
        #expect(EventKind(raw: "consumption_request") == .consumptionRequest)
        #expect(EventKind(raw: "") == .other)
        #expect(EventKind.billingIssue.isNegative)
        #expect(!EventKind.purchase.isNegative)
    }
}
