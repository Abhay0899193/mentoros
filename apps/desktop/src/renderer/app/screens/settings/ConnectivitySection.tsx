import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Copy, Smartphone } from "lucide-react";
import { useSettings } from "../../../lib/settingsStore";
import { coreClient, type NetworkAccessInfo } from "../../../lib/coreClient";
import { riseIn, staggerChildren, reduced } from "../../../motion/springs";
import { Panel, Switch, Button } from "../../../ui";

/**
 * Connectivity — phone/LAN access (docs/MOBILE.md Option A+B).
 * The toggle flips `lanAccess`; the bind change applies on the next launch, so
 * the copy says so plainly. URLs come from the loopback-only /network/access-info
 * route (which also mints the shared token on first call while enabled).
 */
export function ConnectivitySection() {
  const settings = useSettings((s) => s.settings);
  const setLanAccess = useSettings((s) => s.setLanAccess);
  const reduce = useReducedMotion();

  const lanAccess = settings?.lanAccess ?? false;

  const [info, setInfo] = useState<NetworkAccessInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lanAccess) {
      setInfo(null);
      setInfoError(false);
      return;
    }
    let stale = false;
    coreClient
      .networkAccessInfo()
      .then((i) => {
        if (!stale) setInfo(i);
      })
      .catch(() => {
        if (!stale) setInfoError(true);
      });
    return () => {
      stale = true;
    };
  }, [lanAccess]);

  function copyUrl(url: string) {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl((v) => (v === url ? null : v)), 1600);
    });
  }

  return (
    <Panel title="Connectivity">
      <motion.div
        variants={reduced(reduce, staggerChildren)}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-4"
      >
        <motion.div
          variants={reduced(reduce, riseIn)}
          className="flex items-start justify-between gap-4 px-3 py-1"
        >
          <div>
            <p className="text-small font-medium text-ink">Allow other devices</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Open MentorOS from your phone on this Wi-Fi. Your Mac stays the
              brain — nothing leaves your network. Applies the next time
              MentorOS starts.
            </p>
          </div>
          <Switch
            checked={lanAccess}
            onChange={(v) => void setLanAccess(v)}
            label="Allow other devices"
          />
        </motion.div>

        {lanAccess && (
          <motion.div
            variants={reduced(reduce, riseIn)}
            className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2/60 p-3"
          >
            <div className="flex items-center gap-2">
              <Smartphone size={14} strokeWidth={1.5} className="text-faint" />
              <span className="text-small font-medium text-ink">
                On your phone, open
              </span>
            </div>

            {infoError ? (
              <div className="flex items-center gap-2">
                <AlertCircle size={14} strokeWidth={1.5} className="text-faint" />
                <p className="text-[12px] text-muted">
                  Could not read the access details.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setInfoError(false);
                    coreClient
                      .networkAccessInfo()
                      .then(setInfo)
                      .catch(() => setInfoError(true));
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : !info ? (
              <div className="h-8 w-72 animate-pulse rounded-[8px] bg-surface-2" />
            ) : info.urls.length === 0 ? (
              <p className="text-[12px] text-muted">
                No Wi-Fi address found — is this Mac connected to a network?
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {info.urls.map((url) => (
                  <div key={url} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface-2 hairline px-2.5 py-1.5 font-mono text-[12px] text-body">
                      {url}
                    </code>
                    <button
                      onClick={() => copyUrl(url)}
                      aria-label="Copy URL"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-faint hover:bg-surface-2 hover:text-body"
                    >
                      {copiedUrl === url ? (
                        <Check size={14} strokeWidth={1.5} className="text-success" />
                      ) : (
                        <Copy size={14} strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[12px] text-faint">
              The link carries a private access token — treat it like a
              password. Chat, interviews, and the studio work over Wi-Fi; the
              microphone needs HTTPS, which Tailscale provides for free (setup
              in docs/MOBILE.md).
            </p>
          </motion.div>
        )}
      </motion.div>
    </Panel>
  );
}
