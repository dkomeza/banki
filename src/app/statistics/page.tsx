import { sqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function StatisticsPage() {
  const total = (sqlite.prepare("SELECT COUNT(*) count, COALESCE(SUM(duration_ms), 0) duration FROM reviews").get() as { count: number; duration: number });
  const ratings = sqlite.prepare("SELECT rating, COUNT(*) count FROM reviews GROUP BY rating ORDER BY rating").all() as Array<{ rating: number; count: number }>;
  const days = sqlite.prepare("SELECT date(answered_at / 1000, 'unixepoch') day, COUNT(*) count FROM reviews GROUP BY day ORDER BY day DESC LIMIT 14").all() as Array<{ day: string; count: number }>;
  const labels = ["", "Again", "Hard", "Good", "Easy"];
  return <main className="page narrow"><div className="page-title"><p className="eyebrow">Learning record</p><h1>Evidence, not streak theater.</h1><p>Review volume and answer quality remain available locally.</p></div><section className="stat-strip"><div><strong>{total.count}</strong><span>reviews</span></div><div><strong>{Math.round(total.duration / 60000)}</strong><span>minutes</span></div><div><strong>{total.count ? Math.round(((ratings.filter((r) => r.rating > 1).reduce((s, r) => s + r.count, 0)) / total.count) * 100) : 0}%</strong><span>recalled</span></div></section><section className="two-column"><div className="panel"><p className="eyebrow">Answer distribution</p>{[1,2,3,4].map((rating) => { const value = ratings.find((item) => item.rating === rating)?.count ?? 0; return <div className="distribution" key={rating}><span>{labels[rating]}</span><i><b style={{ width: `${total.count ? value / total.count * 100 : 0}%` }} /></i><strong>{value}</strong></div>; })}</div><div className="panel"><p className="eyebrow">Recent days</p>{days.length ? days.map((day) => <div className="day-row" key={day.day}><span>{day.day}</span><strong>{day.count} reviews</strong></div>) : <p className="muted">Complete a session to see history.</p>}</div></section></main>;
}
