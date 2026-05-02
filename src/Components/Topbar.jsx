export default function Topbar({ toggleSidebar }) {
  return (
    <div className="topbar">
      <button onClick={toggleSidebar}>☰</button>
      <h2>Re-Mmogo</h2>
    </div>
  );
}