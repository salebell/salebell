import Foundation

enum Money {
    static func format(_ amount: Double, currency: String) -> String {
        amount.formatted(.currency(code: currency).presentation(.narrow))
    }

    static func usd(_ amount: Double) -> String {
        format(amount, currency: "USD")
    }
}
