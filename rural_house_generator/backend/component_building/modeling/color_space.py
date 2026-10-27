"""Photo colours are sRGB; Blender image pixels are scene-linear floats."""
import numpy as np


def tint_linear_pixels(pixels,target,*,neutralize=False):
    result=np.array(pixels,dtype=np.float32,copy=True)
    srgb=np.clip(np.asarray(target,dtype=float),0,1)
    linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
    if neutralize:
        brightness=result[:,:3]@np.array([.2126,.7152,.0722])
        result[:,:3]=brightness[:,None]/max(float(np.median(brightness)),.01)*linear
    else:
        median=np.median(result[::8,:3],axis=0)
        result[:,:3]*=linear/np.maximum(median,.01)
    result[:,:3]=np.clip(result[:,:3],0,1)
    return result
