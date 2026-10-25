"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaType } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn, input, label } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";

export type SelectedMedia = { url: string; type: MediaType };

type MediaRecord = { id: string; status: "PENDING" | "GENERATING" | "READY" | "FAILED"; url: string | null; type: MediaType; errorMessage: string | null; provider: string; script: string };

type Props = {
  value: SelectedMedia | null;
  onChange: (media: SelectedMedia | null) => void;
  brandId: string;
  required: boolean;
};

const POLL_MS = 3000;

// 投稿に添付する画像・動画（AI で生成、または URL で指定）。1投稿につき1つ
export function MediaPicker({ value, onChange, brandId, required }: Props) {
  const [mode, setMode] = useState<"IMAGE" | "VIDEO" | "URL" | null>(null);
  const [idea, setIdea] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [urlInput, setUrlInput] = useState("");
  const [urlType, setUrlType] = useState<MediaType>("IMAGE");
  const [job, setJob] = useState<MediaRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function poll(id: string) {
    timer.current = setTimeout(async () => {
      try {
        const { media } = await apiFetch<{ media: MediaRecord }>(`/api/media/${id}`);
        setJob(media);
        if (media.status === "READY" && media.url) {
          onChange({ url: media.url, type: media.type });
          setMode(null);
        } else if (media.status === "FAILED") {
          setError(media.errorMessage ?? "生成に失敗しました");
        } else {
          poll(id);
        }
      } catch {
        poll(id);
      }
    }, POLL_MS);
  }

  async function generate(type: MediaType) {
    setError(null);
    try {
      const { media } = await apiFetch<{ media: MediaRecord }>("/api/media/generate", {
        method: "POST",
        body: { type, idea, aspectRatio, brandId: brandId || null },
      });
      setJob(media);
      poll(media.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成を開始できませんでした");
    }
  }

  const generating = job !== null && (job.status === "PENDING" || job.status === "GENERATING");

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">
          画像・動画{required ? <span className="ml-1 text-rose-700">（Instagram は必須）</span> : <span className="ml-1 text-slate-500">（任意）</span>}
        </p>
        {value && (
          <button type="button" className={btn.small + " text-rose-700"} onClick={() => onChange(null)}>
            添付を外す
          </button>
        )}
      </div>

      {value && <MediaPreview media={value} />}

      {!value && !generating && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.small} onClick={() => { setMode("IMAGE"); setAspectRatio("1:1"); }}>AIで画像を作る</button>
          <button type="button" className={btn.small} onClick={() => { setMode("VIDEO"); setAspectRatio("9:16"); }}>AIで動画を作る</button>
          <button type="button" className={btn.small} onClick={() => setMode("URL")}>URLで指定</button>
        </div>
      )}

      {(mode === "IMAGE" || mode === "VIDEO") && !generating && (
        <div className="space-y-2">
          <div>
            <label className={label} htmlFor="media-idea">作りたい{mode === "VIDEO" ? "動画" : "画像"}のイメージ</label>
            <input
              id="media-idea"
              value={idea}
              maxLength={500}
              placeholder={mode === "VIDEO" ? "例：朝の光が差し込むカフェで、コーヒーを淹れる手元" : "例：大阪のカフェで、窓際でノートPCを開いて仕事をしている様子"}
              onChange={(e) => setIdea(e.target.value)}
              className={input}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={label} htmlFor="media-ratio">縦横比</label>
              <select id="media-ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className={input}>
                <option value="1:1">1:1（正方形）</option>
                <option value="4:5">4:5（Instagram の縦長）</option>
                <option value="9:16">9:16（縦長・リール）</option>
                <option value="16:9">16:9（横長）</option>
              </select>
            </div>
            <button type="button" className={btn.primary} disabled={!idea.trim()} onClick={() => generate(mode)}>
              {mode === "VIDEO" ? "動画を生成" : "画像を生成"}
            </button>
            <button type="button" className={btn.secondary} onClick={() => setMode(null)}>キャンセル</button>
          </div>
          <p className="text-xs text-slate-500">
            AIがイメージから生成用の指示を作り、{mode === "VIDEO" ? "約10秒の動画を作ります（数分かかります）" : "画像を作ります（数十秒かかります）"}。文字やロゴ、実在の人物は描かないようにしています。
          </p>
        </div>
      )}

      {generating && (
        <p role="status" className="text-sm text-slate-600">
          {job?.type === "VIDEO" ? "動画" : "画像"}を生成しています…{job?.type === "VIDEO" ? "（数分かかります。このままお待ちください）" : ""}
        </p>
      )}

      {mode === "URL" && (
        <div className="space-y-2">
          <div>
            <label className={label} htmlFor="media-url">画像・動画のURL</label>
            <input id="media-url" type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://example.com/photo.jpg" className={input} />
            <p className="mt-1 text-xs text-slate-500">インターネットから見られる https:// のURLを入力してください。</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1"><input type="radio" name="media-url-type" checked={urlType === "IMAGE"} onChange={() => setUrlType("IMAGE")} />画像</label>
            <label className="flex items-center gap-1"><input type="radio" name="media-url-type" checked={urlType === "VIDEO"} onChange={() => setUrlType("VIDEO")} />動画</label>
            <button type="button" className={btn.small} disabled={!urlInput.trim()} onClick={() => { onChange({ url: urlInput.trim(), type: urlType }); setMode(null); }}>添付する</button>
            <button type="button" className={btn.small} onClick={() => setMode(null)}>キャンセル</button>
          </div>
        </div>
      )}

      {error && <Alert title={error} />}
      {job?.status === "READY" && job.script && <p className="whitespace-pre-wrap text-xs text-slate-500">動画の構成：{job.script}</p>}
    </div>
  );
}

export function MediaPreview({ media }: { media: SelectedMedia }) {
  if (media.type === "VIDEO") {
    if (media.url.startsWith("https://mock.example.com/")) {
      return <div className="flex h-40 items-center justify-center rounded bg-slate-100 text-sm text-slate-500">Mock の動画（実際の動画は FAL_KEY 設定後に生成されます）</div>;
    }
    return <video src={media.url} controls className="max-h-72 rounded" />;
  }
  // 外部の生成サービスの URL を表示するため、next/image ではなく img を使う
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} alt="添付する画像" className="max-h-72 rounded object-contain" />;
}
