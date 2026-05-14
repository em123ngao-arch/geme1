import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { socket } from './socket';

import AuthPage from './pages/AuthPage';
import ProfileSetup from './pages/ProfileSetup';
import Lobby from './pages/Lobby';
import MatchRoom from './pages/MatchRoom';
import GameUI from './pages/GameUI';

function App() {
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);

  useEffect(() => {
    if (token && user?.displayName) {
      socket.auth = { token };
      socket.connect();
    }
    return () => {
      socket.disconnect();
    };
  }, [token, user]);

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', authToken);
  };

  const handleProfileUpdate = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    socket.disconnect();
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          !token ? <AuthPage onLogin={handleLogin} /> : 
          (!user?.displayName ? <Navigate to="/profile" /> : <Navigate to="/lobby" />)
        } />
        
        <Route path="/profile" element={
          token ? <ProfileSetup user={user} onUpdate={handleProfileUpdate} /> : <Navigate to="/" />
        } />

        <Route path="/lobby" element={
          token && user?.displayName ? <Lobby user={user} onLogout={logout} /> : <Navigate to="/" />
        } />

        <Route path="/match/:id" element={
          token && user?.displayName ? <MatchRoom user={user} /> : <Navigate to="/" />
        } />

        <Route path="/game/:id" element={
          token && user?.displayName ? <GameUI user={user} /> : <Navigate to="/" />
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
