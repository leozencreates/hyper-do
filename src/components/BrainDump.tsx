import { useState } from 'react'
import { splitBrainDump } from '../lib/parse'
import { useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  onAdd(lines: string[]): void
  onClose(): void
}

/** Brain dump (#11): paste or type one task per line; every line goes through the quick-add parser. */
export default function BrainDump({ onAdd, onClose }: Props) {
  const t = useT()
  const [v, setV] = useState('')
  const lines = splitBrainDump(v)

  const submit = () => {
    if (lines.length === 0) return
    onAdd(lines)
    onClose()
  }

  return (
    <Modal title={t('brain_title')} onClose={onClose}>
      <p className="hint">{t('brain_hint')}</p>
      <textarea
        className="brain-dump"
        rows={10}
        autoFocus
        value={v}
        placeholder={t('brain_ph')}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
        }}
      />
      <div className="modal-actions">
        <button className="ghost" onClick={onClose}>
          {t('cancel_btn')}
        </button>
        <button className="primary" disabled={lines.length === 0} onClick={submit}>
          {t('brain_add', { n: lines.length })}
        </button>
      </div>
    </Modal>
  )
}
