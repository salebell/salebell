import SwiftUI

struct FeedView: View {
    @Environment(AppModel.self) private var model
    @State private var events: [StoreEventRow] = []
    @State private var appNames: [UUID: String] = [:]
    @State private var phase = LoadPhase.loading

    private static let limit = 100

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Feed")
        }
        .task(id: model.refreshTick) { await load() }
        .task { await listen() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading where events.isEmpty:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message) where events.isEmpty:
            LoadErrorView(message: message) { Task { await load() } }
        default:
            if events.isEmpty {
                ScrollView {
                    if appNames.isEmpty {
                        EmptyAppsView().padding(.top, 40)
                    } else {
                        ContentUnavailableView("No events yet", systemImage: "bolt.horizontal",
                            description: Text("Purchases, renewals and refunds appear here the moment App Store Connect sends them."))
                            .padding(.top, 40)
                    }
                }
                .refreshable { await load() }
            } else {
                List(events) { event in
                    EventRow(event: event, appName: appNames[event.appID] ?? "App")
                }
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
    }

    private func load() async {
        if events.isEmpty { phase = .loading }
        do {
            async let apps = model.backend.apps()
            async let rows = model.backend.recentEvents(limit: Self.limit)
            appNames = Dictionary(uniqueKeysWithValues: try await apps.map { ($0.id, $0.name) })
            events = try await rows
            phase = .loaded
        } catch is CancellationError {
        } catch {
            phase = .failed(UserFacingError.message(for: error))
        }
    }

    private func listen() async {
        for await row in model.backend.liveEvents() {
            guard !events.contains(where: { $0.id == row.id }) else { continue }
            if appNames[row.appID] == nil, let apps = try? await model.backend.apps() {
                appNames = Dictionary(uniqueKeysWithValues: apps.map { ($0.id, $0.name) })
            }
            withAnimation {
                events.insert(row, at: 0)
                events.sort { $0.occurredAt > $1.occurredAt }
                if events.count > Self.limit { events.removeLast(events.count - Self.limit) }
            }
        }
    }
}

struct EventRow: View {
    let event: StoreEventRow
    let appName: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(event.kind.emoji)
                .font(.title3)
                .frame(width: 40, height: 40)
                .background(event.kind.isNegative ? Color.orange.opacity(0.15) : Color.accentColor.opacity(0.12), in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(appName).font(.headline).lineLimit(1)
                    if event.isSandbox {
                        Text("Sandbox")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.yellow.opacity(0.25), in: .capsule)
                    }
                    Spacer(minLength: 8)
                    if let amount = event.formattedAmount {
                        Text(amount)
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle((event.revenue ?? 0) < 0 ? Color.orange : Color.primary)
                    }
                }
                Text(event.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(event.occurredAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = [appName, event.detail]
        if let amount = event.formattedAmount { parts.append(amount) }
        if event.isSandbox { parts.append("Sandbox") }
        parts.append(event.occurredAt.formatted(.relative(presentation: .named)))
        return parts.joined(separator: ", ")
    }
}
