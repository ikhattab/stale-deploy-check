import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Spinner } from "./Spinner";

const Overview = lazy(() => import("./routes/Overview"));
const Orders = lazy(() => import("./routes/Orders"));
const Customers = lazy(() => import("./routes/Customers"));
const Settings = lazy(() => import("./routes/Settings"));

export function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Overview</Link>
        <Link to="/orders">Orders</Link>
        <Link to="/customers">Customers</Link>
        <Link to="/settings">Settings</Link>
      </nav>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
