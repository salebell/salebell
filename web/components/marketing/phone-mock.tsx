// An iPhone lock screen built in HTML/CSS. Example notifications in the real push format (supabase/functions/_shared/core/alerts.ts formatAlert).
import { BELL_PATHS } from "@/components/brand";

const notes = [
  { title: "💰 Focus Timer · $14.99", body: "Purchase · pro.lifetime · USA", time: "now" },
  { title: "🧪 Focus Timer", body: "Trial started · pro.monthly · DEU", time: "4m ago" },
  { title: "🔁 Focus Timer · $4.99", body: "Renewal · pro.monthly · CAN", time: "12m ago" },
];

export function PhoneMock() {
  return (
    <figure className="relative mx-auto w-[17.5rem] shrink-0 sm:w-[18.5rem]">
      <div className="rounded-[2.9rem] bg-[#1b1b1d] p-[0.6rem] shadow-[0_30px_60px_-25px_rgb(0_0_0/0.55),inset_0_0_0_1.5px_#3a3a3d]">
        <div className="relative overflow-hidden rounded-[2.35rem] bg-[radial-gradient(120%_80%_at_30%_0%,#2f6b52_0%,#173628_45%,#0b1712_100%)] px-3 pb-8 pt-3 text-white">
          <div className="mx-auto h-[1.6rem] w-[5.8rem] rounded-full bg-black" aria-hidden="true" />
          <div className="mt-5 text-center" aria-hidden="true">
            <p className="text-[0.8125rem] font-medium text-white/80">Friday 9 October</p>
            <p className="tnum text-[4.25rem] font-semibold leading-none tracking-tight text-white/95">9:41</p>
          </div>
          <ul className="mt-8 space-y-2" aria-label="Example Salebell notifications">
            {notes.map((n, i) => (
              <li
                key={n.title}
                className="animate-pop rounded-[1.15rem] bg-white/[0.16] px-3 py-2.5 backdrop-blur-xl"
                style={{ animationDelay: `${0.4 + i * 0.35}s` }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-[1.6rem] shrink-0 place-items-center rounded-[0.45rem] bg-[#0b7a4b]" aria-hidden="true">
                    <svg viewBox="0 0 32 32" className="size-4">
                      {BELL_PATHS.map((d) => (

                        <path key={d} d={d} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />

                      ))}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-white/60">Salebell</p>
                      <p className="text-[0.6875rem] text-white/55">{n.time}</p>
                    </div>
                    <p className="text-[0.8125rem] font-semibold leading-snug">{n.title}</p>
                    <p className="truncate text-[0.8125rem] leading-snug text-white/80">{n.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mx-auto mt-10 h-1 w-24 rounded-full bg-white/70" aria-hidden="true" />
        </div>
      </div>
      <figcaption className="sr-only">An iPhone lock screen showing example Salebell in-app purchase notifications.</figcaption>
    </figure>
  );
}
