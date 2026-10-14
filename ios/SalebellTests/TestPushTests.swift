import Foundation
import Testing
@testable import Salebell

struct TestPushTests {
    private func result(_ json: String) throws -> TestPushResult {
        try JSONDecoder().decode(TestPushResult.self, from: Data(json.utf8))
    }

    @Test func decodesTestAlertResponse() throws {
        let r = try result(#"{"deliveries":[{"channelId":"x","ok":true,"status":200,"error":null}],"push":{"sent":2,"failed":0}}"#)
        #expect(r.push == .init(sent: 2, failed: 0, error: nil))
        #expect(r.summary == "Sent to 2 iPhones. They should ring in a few seconds.")
    }

    @Test func summaries() throws {
        #expect(try result(#"{"deliveries":[],"push":{"sent":1,"failed":0}}"#).summary.hasPrefix("Sent to 1 iPhone."))
        #expect(try result(#"{"deliveries":[],"push":{"sent":0,"failed":0}}"#).summary.hasPrefix("No iPhone is registered"))
        #expect(try result(#"{"deliveries":[],"push":{"sent":0,"failed":1}}"#).summary.hasPrefix("Apple didn't accept"))
        #expect(try result(#"{"deliveries":[],"push":{"sent":0,"failed":0,"error":"push_not_configured"}}"#).summary
                == "Push isn't set up on the server yet.")
    }

    @Test func rateLimitUsesRetryAfter() {
        let error = TestPushError.from(status: 429, body: Data(#"{"error":"rate_limited","retry_after":37}"#.utf8))
        #expect(error == .rateLimited(retryAfter: 37))
        #expect(error.errorDescription == "Too many tests. Try again in 37 seconds.")
        #expect(TestPushError.from(status: 429, body: Data()) == .rateLimited(retryAfter: 60))
        #expect(TestPushError.from(status: 500, body: Data("{}".utf8)) == .failed)
    }
}
