export function MemoryHorizon({ points }: { points: Array<{ label: string; recall: number }> }) {
  return (
    <div className="horizon" aria-label="Predicted memory through the deadline">
      <div className="horizon-line" />
      {points.map((point, index) => (
        <div className="horizon-point" key={`${point.label}-${index}`}>
          <span className="horizon-column"><i style={{ height: `${Math.max(4, point.recall * 100)}%` }} /></span>
          <strong>{Math.round(point.recall * 100)}%</strong>
          <small>{point.label}</small>
        </div>
      ))}
    </div>
  );
}
