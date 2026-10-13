import { useState } from 'react'
import { STATUSES, type Status, type Task } from '../lib/types'
import { formatDue, isOverdue, recurrenceLabel, recurrenceText } from '../lib/dates'
import { useLang, useT } from '../lib/useT'

type Column = Status | 'done'
const COLUMNS: Column[] = [...STATUSES, 'done']

interface Props {
  /** Görünür (filtrelenmiş) görevler: açık olanlar + son bitenler */
  tasks: Task[]
  highlight: string | null
  onOpen(task: Task): void
  onComplete(id: string): void
  onReopen(id: string): void
  /** Kartı sütuna taşı; beforeId verilirse o kartın önüne, yoksa sona */
  onMove(id: string, to: Column, beforeId: string | null): void
  onAdd(status: Status, text: string): void
}

/** Kanban panosu: Yapılacak / Yapılıyor / Bekliyor / Bitti. Kartlar sürüklenebilir. */
export default function Board({ tasks, highlight, onOpen, onComplete, onReopen, onMove, onAdd }: Props) {
  const t = useT()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null) // sütun ya da kart kimliği

  const columnTasks = (c: Column) =>
    c === 'done'
      ? tasks.filter((x) => x.completedAt !== null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 30)
      : tasks.filter((x) => x.completedAt === null && x.status === c).sort((a, b) => a.order - b.order)

  const dropOnColumn = (c: Column) => {
    if (dragId) onMove(dragId, c, null)
    setDragId(null)
    setOver(null)
  }
  const dropOnCard = (card: Task, c: Column) => {
    if (dragId && dragId !== card.id) onMove(dragId, c, c === 'done' ? null : card.id)
    setDragId(null)
    setOver(null)
  }

  return (
    <div className="board">
      {COLUMNS.map((c) => {
        const list = columnTasks(c)
        return (
          <section
            key={c}
            className={['col', `col-${c}`, over === c && dragId && 'drag-over'].filter(Boolean).join(' ')}
            onDragOver={(e) => {
              e.preventDefault()
              if (over !== c) setOver(c)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              dropOnColumn(c)
            }}
          >
            <header className="col-head">
              <span>{t(`col_${c}` as const)}</span>
              <span className="badge">{list.length}</span>
            </header>
            <div className="col-cards">
              {list.map((x) => (
                <Card
                  key={x.id}
                  task={x}
                  highlighted={highlight === x.id}
                  dragging={dragId === x.id}
                  over={over === x.id && dragId !== x.id}
                  onDragStart={() => setDragId(x.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setOver(null)
                  }}
                  onDragOver={() => over !== x.id && setOver(x.id)}
                  onDrop={() => dropOnCard(x, c)}
                  onOpen={() => onOpen(x)}
                  onToggle={() => (x.completedAt === null ? onComplete(x.id) : onReopen(x.id))}
                />
              ))}
            </div>
            {c !== 'done' && <ColumnAdd onAdd={(text) => onAdd(c, text)} />}
          </section>
        )
      })}
    </div>
  )
}

function ColumnAdd({ onAdd }: { onAdd(text: string): void }) {
  const t = useT()
  const [v, setV] = useState('')
  return (
    <input
      className="col-add"
      value={v}
      placeholder={t('board_add_ph')}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && v.trim()) {
          onAdd(v.trim())
          setV('')
        }
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

interface CardProps {
  task: Task
  highlighted: boolean
  dragging: boolean
  over: boolean
  onDragStart(): void
  onDragEnd(): void
  onDragOver(): void
  onDrop(): void
  onOpen(): void
  onToggle(): void
}

function Card({ task, highlighted, dragging, over, onDragStart, onDragEnd, onDragOver, onDrop, onOpen, onToggle }: CardProps) {
  const t = useT()
  const lang = useLang()
  const done = task.completedAt !== null
  const overdue = !done && isOverdue(task.dueAt)
  const subDone = task.subtasks.filter((s) => s.done).length
  const cls = ['card', `p-${task.priority}`, done && 'done', overdue && 'overdue', task.focused && 'focused', dragging && 'dragging', over && 'drag-over', highlighted && 'highlight']
    .filter(Boolean)
    .join(' ')
  return (
    <article
      id={'task-' + task.id}
      className={cls}
      draggable
      title={t('drag_hint')}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop()
      }}
      onClick={onOpen}
    >
      <button
        className="check small"
        title={done ? t('reopen') : t('finish')}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {done ? '✓' : ''}
      </button>
      <div className="card-body">
        <div className="card-title">
          {task.focused && <span className="chip focus">🎯</span>} {task.title}
        </div>
        <div className="card-meta">
          {task.dueAt !== null && <span className={overdue ? 'due overdue' : 'due'}>{formatDue(task.dueAt, lang)}</span>}
          {task.subtasks.length > 0 && (
            <span className="sub-progress">
              <span className="bar">
                <span style={{ width: `${(subDone / task.subtasks.length) * 100}%` }} />
              </span>
              {subDone}/{task.subtasks.length}
            </span>
          )}
          {task.recurrence !== 'none' && (
            <span className="chip rec" title={recurrenceText(task.recurrence, task.recurrenceRule, lang)}>
              {recurrenceLabel(task.recurrence, task.recurrenceRule, lang)}
            </span>
          )}
          {task.tags.map((x) => (
            <span key={x} className="tag">
              #{x}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
