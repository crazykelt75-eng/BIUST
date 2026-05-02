import { Link } from "react-router-dom";

export default function Sidebar({ open, onClose }) {
  return (
    <div className={`sidebar ${open ? "open" : ""}`}>
      <h2>Re-Mmogo</h2>

      <Link to="/">Dashboard</Link>
      <Link to="/groups">My Groups</Link>

      {/* ❌ NO REPORTS LINK HERE */}
    </div>
  );
}