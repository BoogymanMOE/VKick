export function InlineAd() {
  return (
    <div
      className="my-3 rounded-[12px] border border-dashed border-line bg-[#0a1a16] p-2"
      style={{ height: "56px", overflow: "hidden" }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 min-w-[32px] shrink-0 items-center rounded border border-line px-1 text-[10px] font-bold text-ink-3">
          Ad
        </span>
        <iframe
          data-aa="2458182"
          src="//acceptable.a-ads.com/2458182/?size=Adaptive"
          style={{
            border: "0",
            padding: "0",
            margin: "0",
            display: "block",
            width: "100%",
            height: "56px",
            overflow: "hidden",
            flex: 1,
          }}
          title="Advertisement"
        />
      </div>
    </div>
  );
}
