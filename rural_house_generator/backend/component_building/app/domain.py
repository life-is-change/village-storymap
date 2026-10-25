import math

def number(value,low,high,label,integer=False):
    if isinstance(value,bool): raise ValueError(f'{label}无效')
    try: n=float(value)
    except (ValueError,TypeError): raise ValueError(f'{label}必须是数值')
    if not math.isfinite(n) or not low<=n<=high or (integer and n!=int(n)): raise ValueError(f'{label}范围 {low}–{high}')
    return int(n) if integer else n
