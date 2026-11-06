// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal ERC-165 + Chainlink CRE receiver interfaces.
interface IERC165 {
  function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
  function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title KallVerdicts
 * @notice Kall Markets' public record of what Chainlink CRE decided: whether a coin in a post is real
 *         (coin checks) and whether a call hit or missed (call scores). Only the Chainlink forwarder can write,
 *         so every entry here was agreed by a CRE workflow and signed by its nodes.
 */
contract KallVerdicts is IReceiver {
  enum Kind { CoinCheck, CallScore }

  /// 0 unknown, 1 real, 2 fake (symbol mismatch), 3 fake (impostor of the real coin), 4 no token
  struct CoinCheck {
    address token;
    string claimed;
    string symbol;
    address canonical;
    uint8 verdict;
    uint64 checkedAt;
  }

  /// status: 1 hit, 2 miss, 3 flat. Prices have 8 decimals.
  struct CallScore {
    string postId;
    string handle;
    string asset;
    bool up;
    uint64 postedAt;
    uint64 expiresAt;
    uint256 entry;
    uint256 exit;
    int32 returnBps;
    uint8 status;
  }

  address public immutable forwarder;
  address public immutable owner;
  mapping(bytes32 => CoinCheck) private coins;
  mapping(bytes32 => CallScore) private scores;

  event CoinChecked(address indexed token, string claimed, uint8 verdict, string symbol, address canonical);
  event CallScored(bytes32 indexed postKey, string postId, string handle, uint8 status, int32 returnBps);

  error NotForwarder(address sender);

  constructor(address _forwarder) {
    forwarder = _forwarder;
    owner = msg.sender;
  }

  function onReport(bytes calldata, bytes calldata report) external override {
    if (msg.sender != forwarder) revert NotForwarder(msg.sender);
    (uint8 kind, bytes memory body) = abi.decode(report, (uint8, bytes));
    if (kind == uint8(Kind.CoinCheck)) {
      CoinCheck memory c = abi.decode(body, (CoinCheck));
      coins[coinKey(c.token, c.claimed)] = c;
      emit CoinChecked(c.token, c.claimed, c.verdict, c.symbol, c.canonical);
    } else {
      CallScore[] memory list = abi.decode(body, (CallScore[]));
      for (uint256 i = 0; i < list.length; i++) {
        bytes32 k = keccak256(bytes(list[i].postId));
        scores[k] = list[i];
        emit CallScored(k, list[i].postId, list[i].handle, list[i].status, list[i].returnBps);
      }
    }
  }

  function coinKey(address token, string memory claimed) public pure returns (bytes32) {
    return keccak256(abi.encode(token, claimed));
  }

  function coinCheck(address token, string calldata claimed) external view returns (CoinCheck memory) {
    return coins[coinKey(token, claimed)];
  }

  function callScore(string calldata postId) external view returns (CallScore memory) {
    return scores[keccak256(bytes(postId))];
  }

  function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
    return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
  }
}
