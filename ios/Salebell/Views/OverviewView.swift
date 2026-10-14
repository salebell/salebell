import SwiftUI
import WidgetKit

struct OverviewView: View {
    @Environment(AppModel.self) private var model
    @State private var apps: [AppOverview] = []
    @State private var phase = LoadPhase.loading
    @State private var period = Period.today

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Overview")
                .background(Color(.systemGroupedBackground))
        }
        .task(id: model.refreshTick) { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading where apps.isEmpty:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message) where apps.isEmpty:
            LoadErrorView(message: message) { Task { await load() } }
        default:
            if apps.isEmpty {
                ScrollView { EmptyAppsView().padding(.top, 40) }
                    .refreshable { await load() }
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        Picker("Period", selection: $period) {
                            ForEach(Period.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        TotalsCard(period: period, stats: apps.total(period))
                        Text("Apps")
                            .font(.title3.bold())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 8)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(apps) { AppCard(app: $0) }
                        Text("Gross sales are estimated in USD from customer prices before Apple's commission and taxes.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding()
                }
                .refreshable { await load() }
            }
        }
    }

    private func load() async {
        if apps.isEmpty { phase = .loading }
        do {
            apps = try await model.backend.overview()
            phase = .loaded
            model.didLoadApps(hasApps: !apps.isEmpty)
            if !model.isDemo { WidgetCenter.shared.reloadAllTimelines() }
        } catch is CancellationError {
        } catch {
            phase = .failed(UserFacingError.message(for: error))
        }
    }
}

enum LoadPhase: Equatable {
    case loading, loaded, failed(String)
}

private struct TotalsCard: View {
    let period: Period
    let stats: PeriodStats

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Gross sales · \(period.title)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(Money.usd(stats.grossUSD))
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .contentTransition(.numericText())
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Gross sales, \(period.title), \(Money.usd(stats.grossUSD)), estimated")

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 0) { counters }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 12) { counters }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
    }

    @ViewBuilder
    private var counters: some View {
        Counter(title: "Purchases", value: stats.purchases)
        Counter(title: "Trials", value: stats.trials)
        Counter(title: "Renewals", value: stats.renewals)
        Counter(title: "Refunds", value: stats.refunds, tint: stats.refunds > 0 ? .orange : .primary)
    }
}

private struct Counter: View {
    let title: String
    let value: Int
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value, format: .number)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(value)")
    }
}

private struct AppCard: View {
    let app: AppOverview

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(app.name).font(.headline)
                    if app.alertsPaused {
                        Spacer()
                        Label("Alerts paused", systemImage: "bell.slash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(app.bundleID)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top) { figures }
                VStack(alignment: .leading, spacing: 8) { figures }
            }
            if let last = app.lastProductionEventAt ?? app.lastSandboxEventAt {
                Label {
                    Text("Last event \(last, format: .relative(presentation: .named))")
                } icon: {
                    Image(systemName: "dot.radiowaves.left.and.right")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            } else {
                Label("Waiting for the first notification", systemImage: "hourglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("In App Store Connect, check that both notification URLs are saved and Version 2 is selected. New in-app purchases and subscriptions appear after Apple sends them.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Link("Review the setup guide", destination: AppConfig.docsURL)
                    .font(.footnote.weight(.semibold))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var figures: some View {
        ForEach(Period.allCases) { period in
            VStack(alignment: .leading, spacing: 2) {
                Text(Money.usd(app.stats(period).grossUSD))
                    .font(.body.weight(.semibold))
                    .monospacedDigit()
                Text(period.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(period.title): \(Money.usd(app.stats(period).grossUSD))")
        }
    }
}
