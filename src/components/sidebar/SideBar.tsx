import { useState } from "react"
import icons from "@/assets/icons/icons";
import { useChatStore } from "@/store/chatStore";
import HistorySession from "../HistorySession/HistorySession";
import "./SideBar.css";

const SideBar = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const [extend, setExtend] = useState<boolean>(() => window.innerWidth > 768);
  const createSession = useChatStore(state => state.createSession);

  const changeExtend = () => {
    setExtend(!extend);
  }

  const handleAddNewSession = () => {
    createSession();
    if (window.innerWidth <= 768) setExtend(false);
  }

  return (
    <div className={`sideBar ${extend ? "expanded" : ""}`}>
      <div className="top">
        {/* 标题 */}
        <div className="title">
          {extend && <div className="titleText">ZHAI AI</div>}
          <button type="button" className="sidebarToggle" onClick={changeExtend} aria-label={extend ? "收起侧栏" : "展开侧栏"}>
            <img src={icons.menuIcon} alt="" className="icon" />
          </button>
        </div>
        <div className="menu">
          <button type="button" className="menuItem selected" aria-label="聊天">
            <span className="navGlyph" aria-hidden="true">聊</span>
            {extend && <span>聊天</span>}
          </button>
          <button type="button" className="menuItem" onClick={handleAddNewSession} aria-label="添加对话">
            <img src={icons.addSession} alt="" className="icon" />
            {extend && <span>添加对话</span>}
          </button>
          <button type="button" className="menuItem" onClick={() => { onOpenSettings(); if (window.innerWidth <= 768) setExtend(false); }} aria-label="设置">
            <span className="navGlyph" aria-hidden="true">设</span>
            {extend && <span>设置</span>}
          </button>
        </div>
        {extend &&
          <HistorySession onSelect={() => { if (window.innerWidth <= 768) setExtend(false); }} />
        }
      </div>
      <div className="bottom">
        <div className="userCard">
          <div className="touxiang">
            <img src={icons.touxiangIcon} alt="" />
          </div>
          {extend &&
            <div className="username">
              本地开发版
            </div>}
        </div>
      </div>
    </div>
  )
}

export default SideBar
