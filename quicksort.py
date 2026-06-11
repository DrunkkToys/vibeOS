import random

def quicksort(arr, low=0, high=None):
    if high is None:
        high = len(arr) - 1
    if low < high:
        pi = partition(arr, low, high)
        quicksort(arr, low, pi - 1)
        quicksort(arr, pi + 1, high)
    return arr

def partition(arr, low, high):
    pivot = arr[high]
    i = low - 1
    for j in range(low, high):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]
    arr[i + 1], arr[high] = arr[high], arr[i + 1]
    return i + 1


if __name__ == "__main__":
    import unittest

    class TestQuicksort(unittest.TestCase):
        def test_empty(self):
            self.assertEqual(quicksort([]), [])

        def test_single(self):
            self.assertEqual(quicksort([1]), [1])

        def test_sorted(self):
            self.assertEqual(quicksort([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5])

        def test_reverse(self):
            self.assertEqual(quicksort([5, 4, 3, 2, 1]), [1, 2, 3, 4, 5])

        def test_unsorted(self):
            self.assertEqual(quicksort([3, 6, 8, 10, 1, 2, 1]), [1, 1, 2, 3, 6, 8, 10])

        def test_duplicates(self):
            self.assertEqual(quicksort([4, 4, 4, 4]), [4, 4, 4, 4])

        def test_randomized(self):
            for _ in range(10):
                arr = [random.randint(-100, 100) for _ in range(50)]
                expected = sorted(arr)
                self.assertEqual(quicksort(arr.copy()), expected)

    unittest.main()
