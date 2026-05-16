import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { socket } from '../socket';
import { Trophy, Home, CheckCircle, XCircle } from 'lucide-react';

export default function GameUI({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  
  const [matchState, setMatchState] = useState(location.state?.matchData || null);
  const [questionData, setQuestionData] = useState(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [result, setResult] = useState(null); // { winnerId, correctIndex, scores, msg }
  const [matchFinished, setMatchFinished] = useState(null); // { winner, finalState }
  const [countdown, setCountdown] = useState(null); // For topic selection -> start
  const [useStar, setUseStar] = useState(false);

  useEffect(() => {
    if (!matchState) {
      navigate('/lobby');
      return;
    }

    socket.on('match_state_update', (newState) => {
      setMatchState(newState);
    });

    socket.on('countdown_tick', (count) => {
      setCountdown(count);
    });

    socket.on('new_question', (data) => {
      setQuestionData(data);
      setTimeLeft(data.timeLimit);
      setSelectedAnswer(null);
      setResult(null);
      setUseStar(false);
    });

    socket.on('answer_result', (data) => {
      setResult(data);
    });

    socket.on('match_finished', (data) => {
      setMatchFinished(data);
    });

    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected!');
      navigate('/lobby');
    });

    return () => {
      socket.off('match_state_update');
      socket.off('countdown_tick');
      socket.off('new_question');
      socket.off('answer_result');
      socket.off('match_finished');
      socket.off('opponent_disconnected');
    };
  }, [id, matchState, navigate]);

  useEffect(() => {
    if (!questionData || result || timeLeft <= 0) return;
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) clearInterval(timer);
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [questionData, result, timeLeft]);

  if (!matchState) return null;

  const me = matchState.players.find(p => p.socketId === socket.id);
  const opponent = matchState.players.find(p => p.socketId !== socket.id);

  const handleSelectAnswer = (index) => {
    if (selectedAnswer !== null || result || matchState.failedAttempts?.includes(socket.id)) return;
    setSelectedAnswer(index);
    socket.emit('submit_answer', { matchId: id, questionIndex: questionData.index, answerIndex: index, useStar });
  };

  const handleSelectTopic = (topic) => {
    socket.emit('select_topic', { matchId: id, topic });
  };

  if (matchFinished) {
    const isWinner = matchFinished.winner === socket.id;
    const isDraw = matchFinished.winner === null;
    
    return (
      <div className="container center-content">
        <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', textAlign: 'center', padding: '4rem 2rem' }}>
          <Trophy size={64} color={isWinner ? 'var(--success)' : (isDraw ? 'var(--text-muted)' : 'var(--danger)')} style={{ marginBottom: '1rem' }} />
          <h2 className="text-gradient" style={{ fontSize: '3rem', marginBottom: '1rem' }}>
            {isDraw ? "Hòa nhau!" : (isWinner ? "Bạn Thắng!" : "Bạn Thua!")}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.25rem', marginBottom: '3rem' }}>
            {matchFinished.finalState.mode === 1 
              ? `Tỉ số: ${matchFinished.finalState.scores[me.socketId]} - ${matchFinished.finalState.scores[opponent.socketId]}`
              : `Số vòng thắng: ${matchFinished.finalState.roundWins[me.socketId]} - ${matchFinished.finalState.roundWins[opponent.socketId]}`}
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/lobby')} style={{ width: '100%' }}>
            <Home style={{ marginRight: '0.5rem' }} /> Trở về Sảnh
          </button>
        </div>
      </div>
    );
  }

  if (matchState.status === 'waiting_topic') {
    const amIChoosing = matchState.topicChooser === socket.id;
    return (
      <div className="container center-content">
        <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', textAlign: 'center' }}>
          <h2 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Vòng {matchState.round}</h2>
          
          {amIChoosing ? (
            <div>
              <p style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Đến lượt bạn chọn chủ đề!</p>
              
              <div className="glass-panel" style={{ padding: '2rem', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ marginBottom: '1.5rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Thư viện chủ đề (Có sẵn)</h4>
                {matchState.topics && matchState.topics.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    {matchState.topics.map(t => (
                      <button 
                        key={t} 
                        className="btn btn-outline" 
                        style={{ padding: '1rem', fontSize: '0.9rem', height: 'auto', textAlign: 'center' }}
                        onClick={() => handleSelectTopic(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>Đang tải danh sách...</p>
                )}

                <div style={{ margin: '2rem 0', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem' }}>
                  <h4 style={{ marginBottom: '1rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px' }}>Hoặc tự tạo chủ đề mới (AI)</h4>
                  <form onSubmit={(e) => { e.preventDefault(); handleSelectTopic(e.target.elements.topic.value); }} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input name="topic" type="text" className="input-field" placeholder="Nhập chủ đề bất kỳ..." required style={{ flex: 1 }} />
                    <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>Tạo Đề AI</button>
                  </form>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ margin: '4rem 0' }}>
              <p style={{ fontSize: '1.5rem', color: 'var(--text-muted)' }}>
                Đang đợi {opponent.displayName} chọn chủ đề...
              </p>
              <div style={{ marginTop: '2rem', animation: 'pulse 1.5s infinite' }}>⏳</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (matchState.status === 'generating') {
    return (
      <div className="container center-content">
        <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: '600px' }}>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '1.5rem', marginBottom: '1rem' }}>
            Đang chuẩn bị đề bài về "{matchState.currentTopic}"... Vui lòng chờ!
          </h3>
          <div style={{ marginTop: '2rem', animation: 'pulse 1.5s infinite', fontSize: '3rem' }}>🧠</div>
        </div>
      </div>
    );
  }

  if (matchState.status === 'countdown') {
    return (
      <div className="container center-content">
        <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem' }}>
          <h2 style={{ fontSize: '2rem', marginBottom: '2rem', color: 'var(--text-muted)' }}>Chuẩn bị!</h2>
          <div className="countdown">{countdown}</div>
        </div>
      </div>
    );
  }

  const scores = result ? result.scores : matchState.scores;

  return (
    <div className="container">
      <header className="game-header">
        <div className="score-board">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span className="avatar-option" style={{ width: '40px', height: '40px', fontSize: '1.5rem' }}>{me.avatar}</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{me.displayName} (Bạn)</span>
              <span style={{ color: 'var(--primary)' }}>
                Điểm: {scores[me.socketId]} {matchState.mode === 2 && `| Thắng: ${matchState.roundWins[me.socketId]} vòng`}
              </span>
              {matchState.stars && (
                <span style={{ fontSize: '0.875rem', color: matchState.stars[me.socketId] > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  ⭐ {matchState.stars[me.socketId]}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
            Vòng {matchState.round} {matchState.mode === 2 && `/ 3`}
          </div>
          {matchState.currentTopic && (
            <div style={{ fontSize: '0.875rem', color: 'var(--accent)', marginTop: '0.25rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Chủ đề: {matchState.currentTopic}
            </div>
          )}
        </div>

        <div className="score-board">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexDirection: 'row-reverse', textAlign: 'right' }}>
            <span className="avatar-option" style={{ width: '40px', height: '40px', fontSize: '1.5rem' }}>{opponent.avatar}</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{opponent.displayName}</span>
              <span style={{ color: 'var(--danger)' }}>
                Điểm: {scores[opponent.socketId]} {matchState.mode === 2 && `| Thắng: ${matchState.roundWins[opponent.socketId]} vòng`}
              </span>
              {matchState.stars && (
                <span style={{ fontSize: '0.875rem', color: matchState.stars[opponent.socketId] > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  ⭐ {matchState.stars[opponent.socketId]}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {questionData ? (
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          
          <div className="timer-bar-container">
            <div 
              className={`timer-bar ${timeLeft <= 3 ? 'danger' : (timeLeft <= 5 ? 'warning' : '')}`}
              style={{ width: `${(timeLeft / questionData.timeLimit) * 100}%` }}
            />
          </div>

          <h2 className="question-text">{questionData.q}</h2>

          {matchState.failedAttempts?.includes(me.socketId) && !result && (
            <div style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--danger)', fontWeight: 'bold' }}>
              Bạn đã trả lời sai khi dùng sao! Đang chờ đối thủ...
            </div>
          )}
          {matchState.failedAttempts?.includes(opponent.socketId) && !result && (
            <div style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--success)', fontWeight: 'bold', animation: 'pulse 1s infinite' }}>
              Đối thủ dùng sao và trả lời sai. Cơ hội thuộc về bạn!
            </div>
          )}

          <div className="options-grid">
            {questionData.options.map((opt, i) => {
              let className = "option-btn";
              if (result) {
                if (i === result.correctIndex) className += " correct";
                else if (i === selectedAnswer) className += " wrong";
              } else if (selectedAnswer === i) {
                className += " selected";
              }

              const isDisabled = selectedAnswer !== null || result !== null || matchState.failedAttempts?.includes(me.socketId);

              return (
                <button 
                  key={i} 
                  className={className}
                  onClick={() => handleSelectAnswer(i)}
                  disabled={isDisabled}
                  style={selectedAnswer === i && !result ? { borderColor: 'var(--primary)', background: 'rgba(59, 130, 246, 0.2)' } : {}}
                >
                  {opt}
                  {result && i === result.correctIndex && <CheckCircle size={20} style={{ float: 'right' }} />}
                  {result && i === selectedAnswer && i !== result.correctIndex && <XCircle size={20} style={{ float: 'right' }} />}
                </button>
              );
            })}
          </div>

          {!result && !matchState.failedAttempts?.includes(me.socketId) && matchState.stars?.[me.socketId] > 0 && (
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button 
                className={`btn ${useStar ? 'btn-warning' : 'btn-outline'}`}
                onClick={() => setUseStar(!useStar)}
                disabled={selectedAnswer !== null}
                style={{ 
                  background: useStar ? 'var(--warning)' : 'transparent', 
                  color: useStar ? '#000' : 'var(--warning)',
                  borderColor: 'var(--warning)',
                  fontWeight: 'bold',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                ⭐ Dùng Ngôi Sao Hy Vọng (+2 điểm / Sai nhường lượt)
              </button>
            </div>
          )}

          {result && (
            <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '1.5rem', fontWeight: 'bold' }}>
              {result.msg ? (
                <span style={{ color: result.winnerId === socket.id ? 'var(--success)' : (result.winnerId ? 'var(--danger)' : 'var(--text-muted)') }}>
                  {result.msg}
                </span>
              ) : result.winnerId === socket.id ? (
                <span style={{ color: 'var(--success)' }}>Chính xác! +1</span>
              ) : result.winnerId === opponent.socketId ? (
                <span style={{ color: 'var(--danger)' }}>{opponent.displayName} đã trả lời trước!</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Không ai ghi được điểm.</span>
              )}
            </div>
          )}

        </div>
      ) : (
        <div className="center-content">
          <h2 style={{ color: 'var(--text-muted)' }}>Đang chuẩn bị câu hỏi...</h2>
        </div>
      )}
    </div>
  );
}
