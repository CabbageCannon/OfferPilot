import { useState } from "react";
import SideBar from "./components/sidebar/SideBar";
import Main from "./components/main/main";
import Settings from "./components/Settings/Settings";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (<>
    <SideBar onOpenSettings={() => setSettingsOpen(true)} />
    <Main />
    {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
  </>);
}

export default App
