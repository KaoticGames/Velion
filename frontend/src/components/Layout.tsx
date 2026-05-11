import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';

/** Root layout: sticky nav + single scrollable page area (document does not scroll) */
export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      <NavBar />
      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
