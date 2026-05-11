import { createBrowserRouter } from 'react-router-dom';
import Layout          from '@/components/Layout';
import ProtectedRoute  from '@/components/ProtectedRoute';
import Login           from '@/pages/Login';
import Register        from '@/pages/Register';
import Characters      from '@/pages/Characters';
import CharacterSheetPage from '@/pages/CharacterSheetPage';
import CharacterWizard    from '@/pages/CharacterWizard';
import { NotFound } from '@/pages/Stubs';
import Campaigns from '@/pages/Campaigns';
import CampaignDetail from '@/pages/CampaignDetail';
import JoinCampaign from '@/pages/JoinCampaign';
import Library from '@/pages/Library';
import Compendium from '@/pages/Compendium';
import Homebrew from '@/pages/Homebrew';
import HomeAuthenticated from '@/pages/HomeAuthenticated';
import Account from '@/pages/Account';
import IndexGate from '@/pages/IndexGate';
import About from '@/pages/About';
import VTT from '@/vtt/VTT';

export const router = createBrowserRouter([
  // ── VTT — fullscreen, no Layout wrapper ───────────────────────────────
  {
    path:    '/vtt/:sessionId',
    element: <ProtectedRoute><VTT /></ProtectedRoute>,
  },
  {
    path:    '/',
    element: <Layout />,
    children: [

      // ── Public ────────────────────────────────────────────────────────
      { index:   true,            element: <IndexGate /> },
      { path:    'login',         element: <Login /> },
      { path:    'register',      element: <Register /> },
      { path:    'about',         element: <About /> },

      // ── Protected: logged-in home (hub) ────────────────────────────────
      {
        path:    'home',
        element: <ProtectedRoute><HomeAuthenticated /></ProtectedRoute>,
      },
      {
        path:    'account',
        element: <ProtectedRoute><Account /></ProtectedRoute>,
      },

      // ── Protected: character routes ────────────────────────────────────
      {
        path:    'characters',
        element: <ProtectedRoute><Characters /></ProtectedRoute>,
      },
      {
        // /characters/new — multi-step character creation wizard
        path:    'characters/new',
        element: <ProtectedRoute><CharacterWizard /></ProtectedRoute>,
      },
      {
        // /characters/:id — view/edit an existing character
        // Optional ?session=<sessionId> query param activates combat sync
        path:    'characters/:id',
        element: <ProtectedRoute><CharacterSheetPage /></ProtectedRoute>,
      },

      // ── Protected: campaigns ───────────────────────────────────────────
      {
        path:    'campaigns',
        element: <ProtectedRoute><Campaigns /></ProtectedRoute>,
      },
      {
        path:    'campaigns/:id',
        element: <ProtectedRoute><CampaignDetail /></ProtectedRoute>,
      },
      {
        path:    'join/:token',
        element: <ProtectedRoute><JoinCampaign /></ProtectedRoute>,
      },

      // ── Protected: library ─────────────────────────────────────────────
      {
        path:    'library/*',
        element: <ProtectedRoute><Library /></ProtectedRoute>,
      },

      // ── Protected: compendium ──────────────────────────────────────────
      {
        path:    'compendium',
        element: <ProtectedRoute><Compendium /></ProtectedRoute>,
      },
      {
        path:    'compendium/*',
        element: <ProtectedRoute><Compendium /></ProtectedRoute>,
      },

      // ── Protected: homebrew workshop ───────────────────────────────────
      {
        path:    'homebrew',
        element: <ProtectedRoute><Homebrew /></ProtectedRoute>,
      },

      // ── 404 ───────────────────────────────────────────────────────────
      { path: '*', element: <NotFound /> },
    ],
  },
]);