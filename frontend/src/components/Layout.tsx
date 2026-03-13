import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';

/** Root layout: sticky nav + scrollable page area */
export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <NavBar />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
