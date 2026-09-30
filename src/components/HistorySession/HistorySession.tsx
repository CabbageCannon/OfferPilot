import { useChatStore } from "@/store/chatStore"
import "./HistorySession.css";

const HistorySession = ({ onSelect }: { onSelect?: () => void }) => {
  const sessions = useChatStore(state => state.sessions);
  const selectSession = useChatStore(state => state.selectSession);
  const currentSessionId = useChatStore(state => state.currentSession);

  const handleSelectSession = (selectSessionId: string) => {
    selectSession(selectSessionId);
    onSelect?.();
  }

  return (<div className="historySession">
    <div className="historySessionTitle">最近</div>
    <div className="historySessions">
      {sessions.map((session) => {
        return <button type="button"
          key={session.id}
          className={`historySessionItem ${session.id === currentSessionId ? "selected" : ""}`}
          onClick={() => { handleSelectSession(session.id) }}>
          {session.title}
        </button>
      })}
    </div>
  </div>)
}

export default HistorySession;
