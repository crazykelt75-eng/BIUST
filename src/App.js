import { BrowserRouter, Routes, Route } from "react-router-dom";
import Groups from "./pages/Groups";
import Dashboard from "./pages/Dashboard";
import "./styles/styles.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/groups" element={<Groups />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;