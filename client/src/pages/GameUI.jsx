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
  const [activeTopic, setActiveTopic] = useState(null);

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

  const handleSelectTopic = (topic, difficulty = "bình thường") => {
    socket.emit('select_topic', { matchId: id, topic, difficulty });
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
    
    // Thống kê các chủ đề phụ chính thức
    const officialSubtopics = {
      it: [
        { name: 'Python', desc: 'Sẵn có 50 câu' },
        { name: 'Java', desc: 'Sẵn có 50 câu' },
        { name: 'JavaScript', desc: 'AI tạo đề' },
        { name: 'C++', desc: 'AI tạo đề' }
      ],
      language: [
        { name: 'Ngôn ngữ Hàn quốc', desc: 'Sẵn có 50 câu' },
        { name: 'Tiếng Anh', desc: 'AI tạo đề' },
        { name: 'Tiếng Nhật', desc: 'AI tạo đề' }
      ],
      music: [
        { name: 'Nhóm nhạc BTS', desc: 'Sẵn có 100 câu (Dễ/TB)' },
        { name: 'Nhạc Pop', desc: 'AI tạo đề' },
        { name: 'Nhạc Cổ điển', desc: 'AI tạo đề' }
      ]
    };

    const majorSubtopicsList = ['Python', 'Java', 'Ngôn ngữ Hàn quốc', 'Nhóm nhạc BTS'];
    const otherTopics = (matchState.topics || []).filter(t => !majorSubtopicsList.includes(t));

    return (
      <div className="container center-content">
        <div className="glass-panel" style={{ width: '100%', maxWidth: '850px', textAlign: 'center', position: 'relative' }}>
          <h2 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Vòng {matchState.round}</h2>
          
          {amIChoosing ? (
            <div>
              <p style={{ fontSize: '1.25rem', marginBottom: '2rem', color: 'var(--primary)', fontWeight: 'bold' }}>
                🎉 Đến lượt bạn chọn chủ đề! Bấm chọn một chủ đề bên dưới:
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                
                {/* Khối IT */}
                <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)', textAlign: 'left' }}>
                  <h4 style={{ color: 'var(--primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    💻 Công nghệ thông tin
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {officialSubtopics.it.map(sub => (
                      <button
                        key={sub.name}
                        className="btn btn-outline"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', fontSize: '0.875rem', height: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}
                        onClick={() => setActiveTopic(sub.name)}
                      >
                        <span style={{ fontWeight: 'bold' }}>{sub.name}</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{sub.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Khối Ngôn ngữ */}
                <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(16, 185, 129, 0.05)', borderColor: 'rgba(16, 185, 129, 0.2)', textAlign: 'left' }}>
                  <h4 style={{ color: 'var(--success)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    🗣️ Ngôn ngữ
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {officialSubtopics.language.map(sub => (
                      <button
                        key={sub.name}
                        className="btn btn-outline"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', fontSize: '0.875rem', height: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}
                        onClick={() => setActiveTopic(sub.name)}
                      >
                        <span style={{ fontWeight: 'bold' }}>{sub.name}</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{sub.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Khối Âm nhạc */}
                <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)', textAlign: 'left' }}>
                  <h4 style={{ color: 'var(--warning)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    🎵 Âm nhạc
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {officialSubtopics.music.map(sub => (
                      <button
                        key={sub.name}
                        className="btn btn-outline"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', fontSize: '0.875rem', height: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}
                        onClick={() => setActiveTopic(sub.name)}
                      >
                        <span style={{ fontWeight: 'bold' }}>{sub.name}</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{sub.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              {/* Các chủ đề khác */}
              <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.01)', textAlign: 'left', marginBottom: '2rem' }}>
                <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '1rem', letterSpacing: '1px' }}>📚 Thư viện chủ đề có sẵn khác</h4>
                {otherTopics.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
                    {otherTopics.map(t => (
                      <button 
                        key={t} 
                        className="btn btn-outline" 
                        style={{ padding: '0.75rem', fontSize: '0.85rem', height: 'auto', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}
                        onClick={() => setActiveTopic(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Đang tải danh sách...</p>
                )}
              </div>

              {/* Tự tạo chủ đề mới (AI) */}
              <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(139, 92, 246, 0.03)', borderColor: 'rgba(139, 92, 246, 0.1)', textAlign: 'left' }}>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '1rem' }}>🔮 Hoặc tự tạo chủ đề mới bằng AI</h4>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <input 
                    id="ai-topic-input" 
                    type="text" 
                    className="input-field" 
                    placeholder="Nhập chủ đề bất kỳ (VD: Worldcup 2022, K-Pop, Lịch sử nhà Trần...)" 
                    style={{ flex: 1, padding: '0.75rem 1rem' }} 
                  />
                  <button 
                    className="btn btn-accent" 
                    style={{ padding: '0 1.5rem' }}
                    onClick={() => {
                      const val = document.getElementById('ai-topic-input').value.trim();
                      if (val) setActiveTopic(val);
                    }}
                  >
                    Bắt đầu
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <div style={{ margin: '4rem 0' }}>
              <p style={{ fontSize: '1.5rem', color: 'var(--text-muted)' }}>
                Đang đợi {opponent.displayName} chọn chủ đề...
              </p>
              <div style={{ marginTop: '2rem', animation: 'pulse 1.5s infinite', fontSize: '2rem' }}>⏳</div>
            </div>
          )}

          {/* Modal chọn độ khó cao cấp */}
          {activeTopic && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              animation: 'fadeIn 0.2s ease-out'
            }}>
              <div className="glass-panel" style={{
                width: '90%',
                maxWidth: '450px',
                padding: '2.5rem',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                animation: 'slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
              }}>
                <h3 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Chọn độ khó</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '1rem' }}>
                  Chủ đề: <span style={{ color: '#fff', fontWeight: 'bold' }}>{activeTopic}</span>
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                  
                  {/* Cổng Dễ */}
                  <button 
                    className="btn btn-outline" 
                    style={{ 
                      padding: '1rem 1.25rem', 
                      fontSize: '1rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      borderColor: 'rgba(16, 185, 129, 0.3)',
                      background: 'rgba(16, 185, 129, 0.05)',
                      color: 'var(--success)'
                    }}
                    onClick={() => {
                      handleSelectTopic(activeTopic, 'dễ');
                      setActiveTopic(null);
                    }}
                  >
                    <span>🟢 Dễ (Easy)</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7, color: 'var(--text-muted)' }}>
                      {activeTopic === 'Nhóm nhạc BTS' ? 'Sẵn có (50 câu)' : 'Kiến thức cơ bản'}
                    </span>
                  </button>

                  {/* Cổng Trung bình */}
                  <button 
                    className="btn btn-outline" 
                    style={{ 
                      padding: '1rem 1.25rem', 
                      fontSize: '1rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      borderColor: 'rgba(245, 158, 11, 0.3)',
                      background: 'rgba(245, 158, 11, 0.05)',
                      color: 'var(--warning)'
                    }}
                    onClick={() => {
                      handleSelectTopic(activeTopic, 'bình thường');
                      setActiveTopic(null);
                    }}
                  >
                    <span>🟡 Trung bình (Medium)</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7, color: 'var(--text-muted)' }}>
                      {['Python', 'Java', 'Ngôn ngữ Hàn quốc', 'Nhóm nhạc BTS'].includes(activeTopic) ? 'Sẵn có (50 câu)' : 'Mức độ phổ thông'}
                    </span>
                  </button>

                  {/* Cổng Khó */}
                  <button 
                    className="btn btn-outline" 
                    style={{ 
                      padding: '1rem 1.25rem', 
                      fontSize: '1rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.05)',
                      color: 'var(--danger)'
                    }}
                    onClick={() => {
                      handleSelectTopic(activeTopic, 'khó');
                      setActiveTopic(null);
                    }}
                  >
                    <span>🔴 Khó (Hard)</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7, color: 'var(--text-muted)' }}>Kiến thức chuyên sâu</span>
                  </button>

                  {/* Cổng Siêu khó */}
                  <button 
                    className="btn btn-outline" 
                    style={{ 
                      padding: '1rem 1.25rem', 
                      fontSize: '1rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      borderColor: 'rgba(139, 92, 246, 0.3)',
                      background: 'rgba(139, 92, 246, 0.05)',
                      color: 'var(--accent)'
                    }}
                    onClick={() => {
                      handleSelectTopic(activeTopic, 'siêu khó');
                      setActiveTopic(null);
                    }}
                  >
                    <span>🔥 Siêu khó (Super Hard)</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7, color: 'var(--text-muted)' }}>AI Tạo Đề</span>
                  </button>

                </div>

                <button 
                  className="btn btn-outline" 
                  style={{ width: '100%', borderColor: 'rgba(255,255,255,0.1)' }}
                  onClick={() => setActiveTopic(null)}
                >
                  Đóng
                </button>
              </div>
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

        <div className="stats-container">
          <div className="stat-item">
            <span className="stat-label">Điểm số</span>
            <span className="stat-value highlight">{scores[me.socketId]} - {scores[opponent.socketId]}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Câu hỏi</span>
            <span className="stat-value">{matchState.currentQuestionIndex >= 0 ? matchState.currentQuestionIndex + 1 : 1} / 5</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Vòng chơi</span>
            <span className="stat-value">{matchState.round} {matchState.mode === 2 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ 3</span>}</span>
          </div>
        </div>
        
        {matchState.currentTopic && (
          <div style={{ position: 'absolute', top: '5.5rem', left: '50%', transform: 'translateX(-50%)', fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '2px', background: 'rgba(139, 92, 246, 0.1)', padding: '0.25rem 1rem', borderRadius: '4px' }}>
            {matchState.currentTopic}
          </div>
        )}

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
