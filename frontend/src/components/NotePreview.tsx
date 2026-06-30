// 笔记阅读模式：渲染 HTML + wikilink 跳转。从 NoteView 拆出。
import { useWikilinkNavigation } from "../hooks/useWikilinkNavigation";

interface Props {
  html: string;
}

export default function NotePreview({ html }: Props) {
  // 默认行为（无 onNavigate）：命中 wikilink 后 openNote，等价原 NoteView.onPreviewClick
  const { handleClick } = useWikilinkNavigation();
  return (
    <div onClick={handleClick}>
      <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
