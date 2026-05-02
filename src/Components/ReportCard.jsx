export default function ReportCard({ title, value }) {
  return (
    <div style={{ padding: "10px", background: "#eee", margin: "10px 0", borderRadius: "8px" }}>
      <p>{title}</p>
      <h3>{value}</h3>
    </div>
  );
}