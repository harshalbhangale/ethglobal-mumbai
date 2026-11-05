import { describe, expect, it } from "vitest";
import { oauthHeader, xClient } from "./x-api";

const creds = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

describe("oauthHeader", () => {
  it("matches the worked example on X's Creating a signature page", () => {
    const header = oauthHeader(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      creds,
      { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" },
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header.startsWith("OAuth ")).toBe(true);
  });
});

describe("xClient.mentions", () => {
  it("joins each mention with the call it replies to, oldest first", async () => {
    const fetcher = (async (url: string) => {
      expect(url).toContain("/users/42/mentions");
      expect(url).toContain("since_id=100");
      return Response.json({
        data: [
          { id: "300", text: "@Kallr copy $2", author_id: "7", referenced_tweets: [{ type: "replied_to", id: "200" }] },
          { id: "250", text: "@Kallr hi", author_id: "8" },
        ],
        includes: {
          tweets: [{ id: "200", text: "Buying $ETH here 🚀", author_id: "9" }],
          users: [
            { id: "7", username: "alice" },
            { id: "8", username: "bob" },
            { id: "9", username: "kol" },
          ],
        },
        meta: { newest_id: "300" },
      });
    }) as unknown as typeof fetch;
    const { mentions, newestId } = await xClient(creds, fetcher).mentions("42", "100");
    expect(newestId).toBe("300");
    expect(mentions.map((m) => m.post.id)).toEqual(["250", "300"]);
    expect(mentions[1]).toMatchObject({ author: { username: "alice" }, parent: { id: "200" }, parentAuthor: { username: "kol" } });
    expect(mentions[0]?.parent).toBeNull();
  });
});
