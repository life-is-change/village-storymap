import math

def number(value,low,high,label,integer=False):
    if isinstance(value,bool): raise ValueError(f'{label}无效')
    try: n=float(value)
    except (ValueError,TypeError): raise ValueError(f'{label}必须是数值')
    if not math.isfinite(n) or not low<=n<=high or (integer and n!=int(n)): raise ValueError(f'{label}范围 {low}–{high}')
    return int(n) if integer else n


def floor_height(value, *, from_photo=False):
    # A photo-derived scale is evidence, not a manually chosen residential
    # default. Keep numeric geometry bounds without clipping it to 2.4–5 m.
    return number(value, .1 if from_photo else 2.4, 120 if from_photo else 5, '层高')
