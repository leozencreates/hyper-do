import type { ConnectionStatus } from '../lib/types'
import { translate, type Lang } from '../lib/i18n'

interface Props {
  status: ConnectionStatus
  /** Explicit language: the panel can show before the data (and its language setting) arrived. */
  lang: Lang
  onRetry(): void
}

/**
 * Full-screen state of the Telegram Mini App when the PC cannot be reached (retry) or answered 401/403
 * (not the linked account). Rendered outside the normal app tree, so it gets its language passed in.
 */
export default function ConnectionPanel({ status, lang, onRetry }: Props) {
  const forbidden = status.state === 'forbidden'
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k)
  return (
    <div className="tg-panel" role="alert">
      <div className="tg-panel-box">
        <span className="tg-panel-icon">{forbidden ? '🔒' : '📡'}</span>
        <h2>{forbidden ? t('tgapp_forbidden_title') : t('tgapp_unreachable_title')}</h2>
        <p>{forbidden ? t('tgapp_forbidden_body') : t('tgapp_unreachable_body')}</p>
        {!forbidden && (
          <button type="button" className="primary big" onClick={onRetry}>
            ⟳ {t('tgapp_retry')}
          </button>
        )}
        {status.error && <p className="hint">{status.error}</p>}
      </div>
    </div>
  )
}
