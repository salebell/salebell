import Supabase
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
    enum State { case sales(PeriodStats, week: Double), signedOut, unavailable }
    let date: Date
    let state: State
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: .now, state: .sales(PeriodStats(grossUSD: 52.94, purchases: 4, trials: 3, renewals: 2), week: 405.60))
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (TodayEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(await Self.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<TodayEntry>) -> Void) {
        Task {
            let entry = await Self.load()
            // The app also reloads the widget whenever it fetches fresh numbers.
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
        }
    }

    private static func load() async -> TodayEntry {
        let client = SupabaseClient.salebell()
        guard (try? await client.auth.session) != nil else {
            return TodayEntry(date: .now, state: .signedOut)
        }
        do {
            let apps = try await client.appOverview()
            return TodayEntry(date: .now, state: .sales(apps.total(.today), week: apps.total(.week).grossUSD))
        } catch {
            return TodayEntry(date: .now, state: .unavailable)
        }
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    private var isAccessory: Bool { family == .accessoryRectangular || family == .accessoryInline }
    private var asOf: String { "as of \(entry.date.formatted(date: .omitted, time: .shortened))" }

    var body: some View {
        if isAccessory {
            accessory.containerBackground(for: .widget) { Color.clear }
        } else {
            system
                .containerBackground(for: .widget) {
                    LinearGradient(colors: [Color(red: 0.06, green: 0.62, blue: 0.35), Color(red: 0.03, green: 0.30, blue: 0.29)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                }
                .foregroundStyle(.white)
        }
    }

    // MARK: Home screen

    @ViewBuilder
    private var system: some View {
        switch entry.state {
        case .sales(let today, let week):
            sales(today, week: week)
        case .signedOut:
            message("Open Salebell to sign in.")
        case .unavailable:
            message("Couldn't update. Open Salebell.")
        }
    }

    private func sales(_ today: PeriodStats, week: Double) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Today", systemImage: "bell.fill")
                    .font(.caption.weight(.semibold))
                    .opacity(0.85)
                Spacer(minLength: 0)
                Text(Money.usd(today.grossUSD))
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text(purchases(today))
                    .font(.caption)
                    .opacity(0.85)
                Text(asOf)
                    .font(.caption2)
                    .opacity(0.7)
            }
            if family == .systemMedium {
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    stat("Renewals", "\(today.renewals)")
                    stat("Trials", "\(today.trials)")
                    stat("7 days", Money.usd(week))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(value).font(.headline).monospacedDigit()
            Text(title).font(.caption2).opacity(0.8)
        }
    }

    private func message(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "bell.fill").font(.title2)
            Spacer(minLength: 0)
            Text("Salebell").font(.headline)
            Text(text).font(.caption).opacity(0.85)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    // MARK: Lock screen

    @ViewBuilder
    private var accessory: some View {
        switch (family, entry.state) {
        case (.accessoryInline, .sales(let today, _)):
            Label("\(Money.usd(today.grossUSD)) today", systemImage: "bell.fill")
        case (.accessoryInline, _):
            Label("Salebell", systemImage: "bell.fill")
        case (_, .sales(let today, _)):
            VStack(alignment: .leading, spacing: 1) {
                Label("Today", systemImage: "bell.fill")
                    .font(.caption.weight(.semibold))
                Text(Money.usd(today.grossUSD))
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text("\(purchases(today)) · \(asOf)")
                    .font(.caption2)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        case (_, .signedOut):
            Label("Open Salebell to sign in", systemImage: "bell.fill").font(.caption)
        case (_, .unavailable):
            Label("Couldn't update", systemImage: "bell.fill").font(.caption)
        }
    }

    private func purchases(_ today: PeriodStats) -> String {
        today.purchases == 1 ? "1 purchase" : "\(today.purchases) purchases"
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodaySales", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's sales")
        .description("Gross sales across your apps today, in USD (estimated).")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct SalebellWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}
