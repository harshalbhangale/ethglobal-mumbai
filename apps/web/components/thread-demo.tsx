import { LogoMark } from "./logo";

type Post = {
  name: string;
  handle: string;
  time: string;
  bot?: boolean;
  body: React.ReactNode;
};

const posts: Post[] = [
  {
    name: "Rover",
    handle: "@cryptorover",
    time: "2h",
    body: <>$ETH to 4k this week. Loading here.</>,
  },
  {
    name: "you",
    handle: "@you",
    time: "1m",
    body: (
      <>
        <span className="text-[#1d6fe0]">@AfterMarkets</span> is this legit?
      </>
    ),
  },
  {
    name: "AfterMarkets",
    handle: "@AfterMarkets",
    time: "now",
    bot: true,
    body: (
      <div className="space-y-2">
        <p>
          ETH is <span className="font-semibold text-up">+3.1%</span> since this post.
        </p>
        <p>@cryptorover’s last 20 calls: 12 hit, median +4.2%.</p>
        <p>Replies lean bullish, 68%. Their wallet bought ETH 40 minutes before posting.</p>
        <p className="text-slate">Reply “copy $2” to trade it.</p>
      </div>
    ),
  },
  {
    name: "you",
    handle: "@you",
    time: "now",
    body: (
      <>
        <span className="text-[#1d6fe0]">@AfterMarkets</span> copy $2, TP 10%, SL 5%
      </>
    ),
  },
  {
    name: "AfterMarkets",
    handle: "@AfterMarkets",
    time: "now",
    bot: true,
    body: (
      <div className="space-y-2">
        <p>Bought $2 of ETH on Base at $3,612.</p>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-lg bg-up/10 px-3 py-2">
            <div className="text-slate">Take-profit</div>
            <div className="font-semibold text-up">$3,973</div>
          </div>
          <div className="rounded-lg bg-down/10 px-3 py-2">
            <div className="text-slate">Stop-loss</div>
            <div className="font-semibold text-down">$3,431</div>
          </div>
        </div>
        <p className="text-slate">I’ll call you when one of them hits.</p>
      </div>
    ),
  },
];

function Avatar({ post }: { post: Post }) {
  if (post.bot) return <LogoMark size={36} />;
  const initial = post.name === "you" ? "Y" : post.name[0];
  return (
    <div
      className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${
        post.name === "you" ? "bg-rule text-ink" : "bg-ink-soft text-white"
      }`}
    >
      {initial}
    </div>
  );
}

export function ThreadDemo() {
  return (
    <figure className="w-full max-w-[460px]">
      <div className="rounded-[22px] border border-rule bg-card p-2 shadow-[0_30px_60px_-30px_rgba(20,33,61,0.35)]">
        <ol>
          {posts.map((post, i) => (
            <li
              key={i}
              className="reply-in relative flex gap-3 px-4 py-3.5"
              style={{ animationDelay: `${200 + i * 380}ms` }}
            >
              {i < posts.length - 1 && (
                <span aria-hidden className="absolute top-[52px] bottom-[-6px] left-[33px] w-0.5 bg-rule" />
              )}
              <div className="relative z-10">
                <Avatar post={post} />
              </div>
              <div className="min-w-0 flex-1 text-[15px] leading-[1.45]">
                <div className="mb-0.5 flex items-baseline gap-1.5 text-[14px]">
                  <span className="font-semibold">{post.name === "you" ? "You" : post.name}</span>
                  <span className="truncate text-slate">
                    {post.handle}, {post.time}
                  </span>
                </div>
                <div className={post.bot ? "rounded-xl bg-paper p-3" : ""}>{post.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-3 px-2 text-[13px] text-slate">Example thread. Prices are illustrative.</figcaption>
    </figure>
  );
}
