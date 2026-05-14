import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { socket } from '../socket';

export default function MatchRoom({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  
  const [matchState, setMatchState] = useState(location.state?.matchData || null);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (!matchState) {
      navigate('/lobby');
      return;
    }

    socket.on('match_state_update', (newState) => {
      setMatchState(newState);
      if (newState.status === 'playing' || newState.status === 'waiting_topic') {
        navigate(`/game/${id}`, { state: { matchData: newState } });
      }
    });

    socket.on('countdown_tick', (count) => {
      setCountdown(count);
    });

    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected!');
      navigate('/lobby');
    });

    return () => {
      socket.off('match_state_update');
      socket.off('countdown_tick');
      socket.off('opponent_disconnected');
    };
  }, [id, matchState, navigate]);

  if (!matchState) return null;

  const isReady = matchState.ready[socket.id];
  const me = matchState.players.find(p => p.socketId === socket.id);
  const opponent = matchState.players.find(p => p.socketId !== socket.id) || { displayName: 'Đang đợi...', avatar: '⏳' };
  const opponentReady = matchState.ready[opponent.socketId || opponent.id];

  const handleReady = () => {
    socket.emit('player_ready', { matchId: id });
  };

  return (
    <div className="container center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', textAlign: 'center', padding: '4rem 2rem' }}>
        <h2 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
          {matchState.mode === 1 ? 'Đấu Đơn (Solo)' : 'Trận BO3 (3 Vòng)'}
        </h2>
        
        {matchState.status === 'generating' ? (
          <div style={{ margin: '4rem 0' }}>
            <h3 style={{ color: 'var(--text-muted)', fontSize: '1.5rem', marginBottom: '1rem' }}>Đang nhờ AI soạn đề về "{matchState.currentTopic}"... Vui lòng chờ!</h3>
            <div style={{ marginTop: '2rem', animation: 'pulse 1.5s infinite', fontSize: '3rem' }}>🧠</div>
          </div>
        ) : countdown !== null ? (
          <div style={{ margin: '4rem 0' }}>
            <h3 style={{ color: 'var(--text-muted)', fontSize: '1.5rem', marginBottom: '1rem' }}>Trận đấu bắt đầu sau</h3>
            <div className="countdown">{countdown}</div>
          </div>
        ) : (
          <div style={{ margin: '4rem 0' }}>
            <h3 style={{ color: 'var(--text-muted)', fontSize: '1.5rem', marginBottom: '2rem' }}>Chuẩn bị sẵn sàng!</h3>
            
            <div className="vs-container">
              <div className="player-card">
                <div className={`player-avatar ${isReady ? 'ready' : ''}`}>
                  {me.avatar}
                </div>
                <h3>{me.displayName}</h3>
                {isReady ? (
                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>ĐÃ SẴN SÀNG</span>
                ) : (
                  <button className="btn btn-primary" onClick={handleReady}>SẴN SÀNG</button>
                )}
              </div>

              <div className="vs-text">VS</div>

              <div className="player-card">
                <div className={`player-avatar ${opponentReady ? 'ready' : ''}`}>
                  {opponent.avatar}
                </div>
                <h3>{opponent.displayName}</h3>
                {opponentReady ? (
                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>ĐÃ SẴN SÀNG</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Đang đợi...</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
