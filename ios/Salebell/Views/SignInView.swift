import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model

    private enum Step { case email, code, password }
    private enum Field { case email, code, password }
    static let resendCooldown: TimeInterval = 60

    @State private var showServerSettings = false
    @State private var step = Step.password
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var resendAvailableAt = Date.distantPast
    @State private var isWorking = false
    @State private var errorMessage: String?
    @FocusState private var focus: Field?

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var emailLooksValid: Bool {
        trimmedEmail.range(of: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#, options: .regularExpression) != nil
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                Button { showServerSettings = true } label: {
                    Label(model.configuration.siteURL.host() ?? "Server", systemImage: "server.rack")
                        .font(.footnote)
                }
                switch step {
                case .email: emailStep
                case .code: codeStep
                case .password: passwordStep
                }
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .disabled(isWorking)
            .padding(.horizontal, 24)
            .padding(.top, 56)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(.systemGroupedBackground))
        .sheet(isPresented: $showServerSettings) {
            NavigationStack {
                ServerSettingsView()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showServerSettings = false } } }
            }
        }
        .onAppear { focus = .email }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image("BrandMark")
                .resizable()
                .frame(width: 84, height: 84)
                .clipShape(.rect(cornerRadius: 19, style: .continuous))
                .accessibilityHidden(true)
            Text("Salebell")
                .font(.largeTitle.bold())
            Text("Every in-app purchase and renewal, the moment it happens.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in with the email you use for Salebell. We'll send you a 6-digit code.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("you@example.com", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .focused($focus, equals: .email)
                .onSubmit(sendCode)
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                .accessibilityLabel("Email address")
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let remaining = Int(resendAvailableAt.timeIntervalSince(context.date).rounded(.up))
                Button(action: sendCode) {
                    ButtonLabel(title: remaining > 0 ? "Email me a code (\(remaining)s)" : "Email me a code",
                                isWorking: isWorking)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!emailLooksValid || isWorking || remaining > 0)
            }
            Text("New to Salebell? Signing in creates your account.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Use a password") {
                step = .password
                errorMessage = nil
                focus = emailLooksValid ? .password : .email
            }
            .font(.footnote)
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter the 6-digit code we sent to \(trimmedEmail).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("123456", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(.title2.monospacedDigit())
                .focused($focus, equals: .code)
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                .accessibilityLabel("Six digit code")
                .onChange(of: code) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { code = digits }
                    if digits.count == 6 { verify() }
                }
            Button(action: verify) {
                ButtonLabel(title: "Sign in", isWorking: isWorking)
            }
            .buttonStyle(.borderedProminent)
            .disabled(code.count != 6 || isWorking)
            HStack {
                Button("Use a different email") {
                    step = .email
                    code = ""
                    errorMessage = nil
                    focus = .email
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let remaining = Int(resendAvailableAt.timeIntervalSince(context.date).rounded(.up))
                    Button(remaining > 0 ? "Resend in \(remaining)s" : "Resend code", action: sendCode)
                        .monospacedDigit()
                        .disabled(isWorking || remaining > 0)
                }
            }
            .font(.subheadline)
        }
    }

    private var passwordStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in with your email and password.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("you@example.com", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                .accessibilityLabel("Email address")
            SecureField("Password", text: $password)
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit(signInWithPassword)
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
            Button(action: signInWithPassword) {
                ButtonLabel(title: "Sign in", isWorking: isWorking)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!emailLooksValid || password.isEmpty || isWorking)
            Button("Email me a code instead") {
                step = .email
                password = ""
                errorMessage = nil
                focus = .email
            }
            .font(.subheadline)
        }
    }

    private func sendCode() {
        guard emailLooksValid, !isWorking, Date() >= resendAvailableAt else { return }
        let email = trimmedEmail
        run {
            try await model.backend.sendCode(to: email)
            resendAvailableAt = Date().addingTimeInterval(Self.resendCooldown)
            code = ""
            step = .code
            focus = .code
        }
    }

    private func signInWithPassword() {
        guard emailLooksValid, !password.isEmpty, !isWorking else { return }
        run {
            try await model.backend.signIn(email: trimmedEmail, password: password)
        } onError: {
            password = ""
        }
    }

    private func verify() {
        guard code.count == 6, !isWorking else { return }
        run {
            try await model.backend.verify(email: trimmedEmail, code: code)
        } onError: {
            code = ""
        }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void, onError: @escaping @MainActor () -> Void = {}) {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await work()
            } catch {
                errorMessage = UserFacingError.message(for: error)
                onError()
            }
            isWorking = false
        }
    }
}

private struct ButtonLabel: View {
    let title: String
    let isWorking: Bool

    var body: some View {
        ZStack {
            Text(title).opacity(isWorking ? 0 : 1)
            if isWorking { ProgressView().tint(.white) }
        }
        .font(.headline)
        .frame(maxWidth: .infinity, minHeight: 32)
    }
}
