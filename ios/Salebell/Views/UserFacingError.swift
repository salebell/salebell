import Foundation

enum UserFacingError {
    static func message(for error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "You're offline. Check your connection and try again."
            case .timedOut:
                return "The server took too long to answer. Try again."
            default:
                break
            }
        }
        let text = String(describing: error).lowercased()
        if text.contains("expired") || text.contains("invalid") && text.contains("otp") || text.contains("token has expired") {
            return "That code is wrong or has expired. Request a new one."
        }
        if text.contains("invalid login credentials") || text.contains("invalid_credentials") {
            return "That email and password don't match."
        }
        if text.contains("rate limit") || text.contains("429") {
            return "Too many attempts. Wait a minute and try again."
        }
        return error.localizedDescription
    }
}
