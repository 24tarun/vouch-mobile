import {
  constrainAvatarCropTranslation,
  getAvatarCropLayout,
  getAvatarCropRect,
} from '@/lib/avatar-crop';

describe('avatar crop geometry', () => {
  it('centers and cover-crops a landscape image to a square', () => {
    const layout = getAvatarCropLayout(1200, 800, 300);

    expect(getAvatarCropRect(layout, { zoom: 1, translateX: 0, translateY: 0 })).toEqual({
      originX: 200,
      originY: 0,
      width: 800,
      height: 800,
    });
  });

  it('maps dragging the image to the opposite source crop direction', () => {
    const layout = getAvatarCropLayout(1200, 800, 300);
    const crop = getAvatarCropRect(layout, { zoom: 1, translateX: 75, translateY: 0 });

    expect(crop.originX).toBe(0);
    expect(crop.width).toBe(800);
  });

  it('keeps the image covering the circular viewport', () => {
    const layout = getAvatarCropLayout(800, 1200, 300);

    expect(constrainAvatarCropTranslation(layout, 1, 500, -500)).toEqual({
      translateX: 0,
      translateY: -75,
    });
  });

  it('uses a smaller source crop after zooming in', () => {
    const layout = getAvatarCropLayout(1000, 1000, 300);
    const crop = getAvatarCropRect(layout, { zoom: 2, translateX: 0, translateY: 0 });

    expect(crop).toEqual({ originX: 250, originY: 250, width: 500, height: 500 });
  });
});
