import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { LogOut, Users, Send, Swords, Trophy } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Lobby({ user, onLogout }) {
  const [onlineCount, setOnlineCount] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [queueingMode, setQueueingMode] = useState(null); // 1 or 2
  
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardMode, setLeaderboardMode] = useState(1);

  const chatEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    socket.on('online_count', (count) => setOnlineCount(count));
    
    socket.on('chat_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    socket.on('match_found', (matchData) => {
      setQueueingMode(null);
      navigate(`/match/${matchData.id}`, { state: { matchData } });
    });

    return () => {
      socket.off('online_count');
      socket.off('chat_message');
      socket.off('match_found');
    };
  }, [navigate]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    socket.emit('chat_message', msgInput);
    setMsgInput('');
  };

  const toggleQueue = (mode) => {
    if (queueingMode === mode) {
      socket.emit('leave_queue');
      setQueueingMode(null);
    } else {
      if (queueingMode) socket.emit('leave_queue');
      socket.emit('join_queue', { mode });
      setQueueingMode(mode);
    }
  };

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      // In dev, the API is on same origin if proxied, else need full URL.
      // Vite proxy is usually set up, but let's assume direct fetch works.
      const res = await fetch(`${API_URL}/api/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setHistoryData(data.history);
        setShowHistory(true);
      }
    } catch (e) { console.error(e); }
  };

  const fetchLeaderboard = async (mode) => {
    try {
      const res = await fetch(`${API_URL}/api/leaderboard?mode=${mode}`);
      const data = await res.json();
      if (data.success) {
        setLeaderboardData(data.leaderboard);
        setLeaderboardMode(mode);
        setShowLeaderboard(true);
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className="container">
      <header className="game-header lobby-header" style={{ marginBottom: '1rem', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div 
            className="avatar-option" 
            style={{ background: 'var(--panel-bg)', cursor: 'pointer', border: '2px solid transparent', transition: '0.2s' }}
            onClick={fetchHistory}
            title="Nhấn để xem Lịch Sử Đấu"
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
          >
            {user.avatar}
          </div>
          <div>
            <h2 className="text-gradient" style={{ margin: 0, cursor: 'pointer' }} onClick={fetchHistory} title="Nhấn để xem Lịch Sử Đấu">{user.displayName}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', animation: 'pulse 2s infinite' }}></div>
              Online
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-outline" onClick={() => fetchLeaderboard(1)} style={{ padding: '0.5rem 1rem', borderRadius: '2rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Trophy size={18} /> BXH
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel-bg)', padding: '0.5rem 1rem', borderRadius: '2rem' }}>
            <Users size={18} color="var(--primary)" />
            <span style={{ fontWeight: 'bold' }}>{onlineCount} người ở Sảnh</span>
          </div>
          <button className="btn btn-outline" onClick={onLogout} style={{ padding: '0.5rem', borderRadius: '50%' }}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="lobby-layout">
        <div className="lobby-modes-container">
          
          <div className="glass-panel lobby-mode-card">
            <h3 className="lobby-mode-title">Chế độ 1: Đấu Đơn (Solo)</h3>
            <p className="lobby-mode-desc">
              5 câu hỏi ngẫu nhiên. Ai đạt 3 điểm trước sẽ giành chiến thắng! Đấu trí tốc độ cao.
            </p>
            <button 
              className={`btn lobby-mode-btn ${queueingMode === 1 ? 'btn-danger' : 'btn-primary'}`} 
              onClick={() => toggleQueue(1)}
            >
              <Swords size={20} className="btn-icon" />
              <span>{queueingMode === 1 ? 'Đang tìm trận (Hủy)...' : 'Tìm Trận Đấu Đơn'}</span>
            </button>
          </div>

          <div className="glass-panel lobby-mode-card">
            <h3 className="lobby-mode-title">Chế độ 2: BO3 (Đấu 3 vòng)</h3>
            <p className="lobby-mode-desc">
              Chiến thuật chọn đề. Vòng 1 Ngẫu nhiên. Vòng 2 & 3: Lần lượt chọn chủ đề!
            </p>
            <button 
              className={`btn lobby-mode-btn ${queueingMode === 2 ? 'btn-danger' : 'btn-accent'}`} 
              onClick={() => toggleQueue(2)}
            >
              <Trophy size={20} className="btn-icon" />
              <span>{queueingMode === 2 ? 'Đang tìm trận (Hủy)...' : 'Tìm Trận 3 Vòng'}</span>
            </button>
          </div>

        </div>

        <div className="glass-panel lobby-chat-card">
          <h3 className="lobby-chat-title">Kênh Chat Chung</h3>
          <div className="chat-box">
            <div className="chat-messages">
              {chatMessages.map((msg, i) => {
                const isMe = msg.senderId ? msg.senderId === user.id : msg.sender === user.displayName;
                return (
                  <div key={i} className={`chat-message ${isMe ? 'me' : 'other'}`}>
                    {!isMe && <div className="sender">{msg.sender}</div>}
                    <div>{msg.text}</div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form className="chat-input-area" onSubmit={sendMessage}>
              <input 
                type="text" 
                placeholder="Nói xin chào..." 
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                maxLength={100}
              />
              <button type="submit" style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0.5rem' }}>
                <Send size={20} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%' }}>
            <h2>📜 Lịch Sử Đấu</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem', maxHeight: '400px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {historyData.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Bạn chưa chơi trận nào.</p>
              ) : (
                historyData.map(m => {
                  const isP1 = m.p1Id === user.id;
                  const opponentName = isP1 ? m.p2Name : m.p1Name;
                  const opponentAvatar = isP1 ? m.p2Avatar : m.p1Avatar;
                  const myScore = isP1 ? m.p1Score : m.p2Score;
                  const opponentScore = isP1 ? m.p2Score : m.p1Score;
                  const isWinner = m.winnerId === user.id;
                  const isDraw = !m.winnerId;

                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{new Date(m.createdAt).toLocaleString()} • {m.mode === 1 ? 'Đấu Đơn' : 'Đấu 3 Vòng'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', fontSize: '1.25rem' }}>
                          <span>{user.avatar}</span> <span style={{ fontWeight: 'bold', color: isWinner ? 'var(--success)' : (isDraw ? '' : 'var(--danger)') }}>{myScore}</span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 0.5rem' }}>-</span>
                          <span style={{ fontWeight: 'bold' }}>{opponentScore}</span> <span>{opponentAvatar} {opponentName}</span>
                        </div>
                      </div>
                      <div style={{ fontWeight: 'bold', fontSize: '1.25rem', color: isWinner ? 'var(--success)' : (isDraw ? 'var(--text-muted)' : 'var(--danger)') }}>
                        {isWinner ? 'THẮNG' : (isDraw ? 'HÒA' : 'THUA')}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <button className="btn btn-outline" style={{ marginTop: '1.5rem', width: '100%' }} onClick={() => setShowHistory(false)}>Đóng</button>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="modal-overlay" onClick={() => setShowLeaderboard(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%' }}>
            <h2>🏆 Bảng Xếp Hạng</h2>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className={`btn ${leaderboardMode === 1 ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => fetchLeaderboard(1)}>Đấu Đơn</button>
              <button className={`btn ${leaderboardMode === 2 ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => fetchLeaderboard(2)}>Đấu 3 Vòng</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1.5rem', maxHeight: '400px', overflowY: 'auto' }}>
              {leaderboardData.map((u, i) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '1rem', gap: '1rem' }}>
                  <div style={{ width: '30px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', color: i === 0 ? '#ffd700' : (i === 1 ? '#c0c0c0' : (i === 2 ? '#cd7f32' : '')) }}>#{i+1}</div>
                  <div style={{ fontSize: '1.5rem' }}>{u.avatar}</div>
                  <div style={{ flex: 1, fontWeight: 'bold', fontSize: '1.1rem' }}>{u.displayName} {u.id === user.id && '(Bạn)'}</div>
                  <div style={{ color: 'var(--success)', fontWeight: 'bold' }}>{u.wins} Thắng</div>
                </div>
              ))}
            </div>
            <button className="btn btn-outline" style={{ marginTop: '1.5rem', width: '100%' }} onClick={() => setShowLeaderboard(false)}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}
