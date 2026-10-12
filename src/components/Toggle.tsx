interface Props {
  checked: boolean
  onChange(v: boolean): void
  label: string
  desc: string
}

/** Settings switch with a bold label and a one-line description. */
export default function Toggle({ checked, onChange, label, desc }: Props) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        <small>{desc}</small>
      </span>
    </label>
  )
}
