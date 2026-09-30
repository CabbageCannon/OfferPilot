import "./SuggestionCards.css";

type SuggestionCardsProps = {
  disabled: boolean;
  onSelect: (prompt: string) => void;
};

const suggestions = [
  {
    label: "模拟面试",
    prompt: "请根据当前 JD 和简历开始模拟面试，一次只问一个问题，并根据我的回答追问。",
  },
  {
    label: "简历匹配",
    prompt: "请分析当前 JD 与简历的匹配情况，指出证据和差距，并给出定向简历待审核草稿。",
  },
  {
    label: "公司背调",
    prompt: "请帮我做公司背调。先问我公司全称，再检索公开来源并标注日期。",
  },
  {
    label: "面试复盘",
    prompt: "请复盘我们刚才的面试，根据我的回答列出证据、待改进点和下一步练习建议。",
  },
] as const;

const SuggestionCards = ({ disabled, onSelect }: SuggestionCardsProps) => {
  return (
    <section className="suggestionSection" aria-labelledby="suggestion-title">
      <div className="suggestionHeading">
        <h1 id="suggestion-title">从哪一步开始求职准备？</h1>
        <p>上传 JD 或简历后选择一项，也可以直接输入需求。</p>
      </div>

      <div className="suggestionGrid">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            className="suggestionCard"
            disabled={disabled}
            onClick={() => onSelect(suggestion.prompt)}
          >
            <span className="suggestionLabel">{suggestion.label}</span>
            <span className="suggestionPrompt">{suggestion.prompt}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default SuggestionCards;
