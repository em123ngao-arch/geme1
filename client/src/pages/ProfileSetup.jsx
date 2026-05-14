import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AVATARS = ['😎', '🚀', '🦊', '🐉', '🤖', '👻', '🦄', '👽'];

export default function ProfileSetup({ user, onUpdate }) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatar, setAvatar] = useState(user?.avatar || AVATARS[0]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/profile`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ displayName, avatar })
      });
      const data = await res.json();

      if (res.ok) {
        onUpdate(data.user);
        navigate('/lobby');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '500px' }}>
        <h2 className="text-gradient" style={{ textAlign: 'center', marginBottom: '2rem', fontSize: '2rem' }}>
          Thiết lập Hồ sơ
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Tên hiển thị</label>
            <input 
              type="text" 
              className="input-field" 
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nhập một cái tên thật ngầu..."
              required 
              maxLength={20}
            />
          </div>

          <div className="input-group">
            <label>Chọn Ảnh đại diện</label>
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <div 
                  key={a}
                  className={`avatar-option ${avatar === a ? 'selected' : ''}`}
                  onClick={() => setAvatar(a)}
                >
                  {a}
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="btn btn-accent" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Đang lưu...' : 'Vào Game'}
          </button>
        </form>
      </div>
    </div>
  );
}
